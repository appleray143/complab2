"""Visible, opt-in Windows lab client for Laptop Lab Manager Online.

This agent reports usage and receives only scoped controls (allowance, session pause,
and admin messages). It does not offer remote shell, file browsing, or stealth access.
"""
from __future__ import annotations

import ctypes
import getpass
import glob
import json
import os
import queue
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "agent_config.json"
STATE_PATH = BASE_DIR / "agent_state.json"
MAX_CHAT = 300


def load_json(path: Path, fallback: dict) -> dict:
    try:
        with path.open("r", encoding="utf-8") as stream:
            value = json.load(stream)
        return value if isinstance(value, dict) else fallback.copy()
    except (OSError, json.JSONDecodeError):
        return fallback.copy()


def save_json(path: Path, value: dict) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    try:
        temp.write_text(json.dumps(value, indent=2), encoding="utf-8")
        os.replace(temp, path)
    except OSError:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass


def get_idle_seconds() -> float:
    """Return Windows-wide idle seconds; conservatively return 0 on other OSes."""
    if os.name != "nt":
        return 0.0
    try:
        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
        info = LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(info)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
            return 0.0
        tick_now = ctypes.windll.kernel32.GetTickCount()
        elapsed_ms = (int(tick_now) - int(info.dwTime)) & 0xFFFFFFFF
        return elapsed_ms / 1000.0
    except Exception:
        return 0.0


def latest_browser_url() -> str:
    """Optional Chrome/Edge history peek; only called when explicitly enabled."""
    local = os.environ.get("LOCALAPPDATA", "")
    if not local:
        return ""
    candidates = [
        os.path.join(local, "Google", "Chrome", "User Data", "Default", "History"),
        os.path.join(local, "Microsoft", "Edge", "User Data", "Default", "History"),
    ]
    candidates += glob.glob(os.path.join(local, "Google", "Chrome", "User Data", "Profile *", "History"))
    candidates += glob.glob(os.path.join(local, "Microsoft", "Edge", "User Data", "Profile *", "History"))
    best_url = ""
    best_visit = -1
    for candidate in candidates:
        if not os.path.isfile(candidate):
            continue
        temp_path = None
        try:
            handle, temp_path = tempfile.mkstemp(prefix="llm-history-", suffix=".sqlite")
            os.close(handle)
            shutil.copy2(candidate, temp_path)
            with sqlite3.connect(f"file:{temp_path}?mode=ro", uri=True, timeout=1) as db:
                row = db.execute("SELECT url, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 1").fetchone()
            if row and isinstance(row[0], str) and int(row[1] or 0) > best_visit:
                best_url = row[0][:500]
                best_visit = int(row[1] or 0)
        except (OSError, sqlite3.Error, ValueError, TypeError):
            continue
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
    return best_url


def request_json(url: str, method: str, token: str, payload: dict | None = None, timeout: int = 8) -> dict:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json", "Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        result = response.read(200_000).decode("utf-8")
    value = json.loads(result) if result else {}
    if not isinstance(value, dict):
        raise RuntimeError("Unexpected server response")
    return value


class LaptopAgent:
    def __init__(self):
        self.config = load_json(CONFIG_PATH, {})
        self.server_url = str(self.config.get("server_url", "")).strip().rstrip("/")
        self.pc_number = str(self.config.get("pc_number", "PC-UNSET")).strip()[:24]
        self.device_token = str(self.config.get("device_token", "")).strip()
        self.idle_threshold = max(30, min(900, int(self.config.get("idle_counts_as_inactive_after_seconds", 120))))
        self.interval = max(5, min(60, int(self.config.get("heartbeat_interval_seconds", 10))))
        self.track_urls = self.config.get("track_recent_urls") is True
        self.messages: queue.Queue = queue.Queue()
        self.stop_event = threading.Event()
        self.network_thread = None
        self.pause_overlay = None
        self.last_url_scan = 0.0
        self.recent_url = ""
        self.status_text = "Starting…"
        self.state = load_json(STATE_PATH, {})
        today = date.today().isoformat()
        if self.state.get("usage_day") != today:
            self.state = {"usage_day": today, "active_seconds": 0, "allowance_minutes": 60, "server_blocked": False}
        self.state.setdefault("active_seconds", 0)
        self.state.setdefault("allowance_minutes", 60)
        self.state.setdefault("server_blocked", False)
        self.local_chat_history = []

        self.root = tk.Tk()
        self.root.title(f"Laptop Lab Manager — {self.pc_number}")
        self.root.geometry("630x600")
        self.root.minsize(540, 500)
        self.root.configure(bg="#f3f7fc")
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.build_ui()
        self.root.after(500, self.ui_tick)
        self.root.after(1000, self.count_tick)
        self.save_state()

    def build_ui(self):
        top = tk.Frame(self.root, bg="#102d52", padx=22, pady=17)
        top.pack(fill="x")
        tk.Label(top, text="LAPTOP LAB MANAGER", fg="#9fc8f4", bg="#102d52", font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(top, text=self.pc_number, fg="white", bg="#102d52", font=("Segoe UI", 22, "bold")).pack(anchor="w", pady=(5, 0))
        self.status_label = tk.Label(top, text="● Connecting to administrator…", fg="#b7d8ff", bg="#102d52", font=("Segoe UI", 10))
        self.status_label.pack(anchor="w", pady=(5, 0))

        body = tk.Frame(self.root, bg="#f3f7fc", padx=22, pady=18)
        body.pack(fill="both", expand=True)
        self.block_banner = tk.Frame(body, bg="#fff0ef", padx=14, pady=12)
        self.block_text = tk.Label(self.block_banner, text="SESSION PAUSED BY ADMINISTRATOR", bg="#fff0ef", fg="#a72f2b", font=("Segoe UI", 12, "bold"))
        self.block_text.pack(anchor="w")
        self.block_detail = tk.Label(self.block_banner, text="Contact the lab administrator for assistance.", bg="#fff0ef", fg="#7e4543", font=("Segoe UI", 9))
        self.block_detail.pack(anchor="w", pady=(4, 0))

        stats = tk.Frame(body, bg="#f3f7fc")
        stats.pack(fill="x", pady=(4, 14))
        self.used_value = self.stat_card(stats, "ACTIVE USE TODAY", "0 min", 0)
        self.allowed_value = self.stat_card(stats, "DAILY ALLOWANCE", "60 min", 1)
        self.user_value = self.stat_card(stats, "WINDOWS USER", getpass.getuser(), 2)
        for i in range(3): stats.grid_columnconfigure(i, weight=1, uniform="stats")

        chat_panel = tk.Frame(body, bg="white", highlightbackground="#dfe7f1", highlightthickness=1, padx=12, pady=10)
        chat_panel.pack(fill="both", expand=True)
        tk.Label(chat_panel, text="Administrator messages", bg="white", fg="#193b61", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        self.chat_list = tk.Listbox(chat_panel, height=7, borderwidth=0, highlightthickness=0, bg="#f8fbff", fg="#45576d", font=("Segoe UI", 9), activestyle="none")
        self.chat_list.pack(fill="both", expand=True, pady=9)
        compose = tk.Frame(chat_panel, bg="white")
        compose.pack(fill="x")
        self.chat_input = ttk.Entry(compose)
        self.chat_input.pack(side="left", fill="x", expand=True, ipady=7)
        self.send_btn = ttk.Button(compose, text="Send reply", command=self.send_reply)
        self.send_btn.pack(side="left", padx=(8, 0))
        foot = tk.Label(body, text="This visible agent reports active-use minutes. Website history collection is optional and disabled unless enabled in the configuration.", bg="#f3f7fc", fg="#8392a6", wraplength=580, justify="left", font=("Segoe UI", 8))
        foot.pack(anchor="w", pady=(10, 0))

    @staticmethod
    def stat_card(parent, title, value, column):
        card = tk.Frame(parent, bg="white", highlightbackground="#dfe7f1", highlightthickness=1, padx=10, pady=10)
        card.grid(row=0, column=column, sticky="nsew", padx=(0 if column == 0 else 5, 0 if column == 2 else 5))
        tk.Label(card, text=title, bg="white", fg="#8695a8", font=("Segoe UI", 8, "bold")).pack(anchor="w")
        value_label = tk.Label(card, text=value, bg="white", fg="#173b63", font=("Segoe UI", 16, "bold"))
        value_label.pack(anchor="w", pady=(7, 0))
        return value_label

    def save_state(self):
        save_json(STATE_PATH, self.state)

    @property
    def limit_reached(self):
        allowance = int(self.state.get("allowance_minutes", 60))
        return allowance <= 0 or int(self.state.get("active_seconds", 0)) >= allowance * 60

    @property
    def effective_blocked(self):
        return bool(self.state.get("server_blocked", False)) or self.limit_reached

    def count_tick(self):
        today = date.today().isoformat()
        if self.state.get("usage_day") != today:
            self.state["usage_day"] = today
            self.state["active_seconds"] = 0
        if not self.effective_blocked and get_idle_seconds() < self.idle_threshold:
            self.state["active_seconds"] = int(self.state.get("active_seconds", 0)) + 1
            if self.state["active_seconds"] % 10 == 0:
                self.save_state()
        self.root.after(1000, self.count_tick)

    def ui_tick(self):
        while True:
            try: event = self.messages.get_nowait()
            except queue.Empty: break
            kind = event[0]
            if kind == "status":
                self.status_text = event[1]
                self.status_label.configure(text=f"● {self.status_text}", fg="#a7f0ce" if event[2] else "#ffd3b7")
            elif kind == "state":
                self.state["allowance_minutes"] = int(event[1].get("allowance_minutes", self.state.get("allowance_minutes", 60)))
                self.state["server_blocked"] = bool(event[1].get("blocked", False))
                self.save_state()
            elif kind == "message":
                self.add_chat_line("ADMIN", event[1])
                try: self.root.bell()
                except tk.TclError: pass

        self.used_value.configure(text=f"{int(self.state.get('active_seconds', 0)) // 60} min")
        self.allowed_value.configure(text=f"{int(self.state.get('allowance_minutes', 60))} min")
        self.user_value.configure(text=getpass.getuser()[:24])
        is_blocked = self.effective_blocked
        if is_blocked:
            if not self.block_banner.winfo_manager():
                children = [w for w in self.block_banner.master.winfo_children()]
                self.block_banner.pack(fill="x", pady=(0, 10), before=children[1] if len(children) > 1 else None)
            if self.limit_reached and not self.state.get("server_blocked", False):
                self.block_text.configure(text="DAILY TIME ALLOWANCE REACHED")
            else:
                self.block_text.configure(text="SESSION PAUSED BY ADMINISTRATOR")
        else:
            self.block_banner.pack_forget()
        self.sync_pause_overlay(is_blocked)
        self.root.after(500, self.ui_tick)

    def sync_pause_overlay(self, active: bool):
        """Show an unmistakable full-screen pause notice; this is not a Windows OS lock."""
        if active and (self.pause_overlay is None or not self.pause_overlay.winfo_exists()):
            overlay = tk.Toplevel(self.root)
            self.pause_overlay = overlay
            overlay.title("Managed session paused")
            overlay.configure(bg="#102d52")
            overlay.attributes("-topmost", True)
            overlay.attributes("-fullscreen", True)
            overlay.protocol("WM_DELETE_WINDOW", lambda: None)
            center = tk.Frame(overlay, bg="#102d52", padx=32, pady=32)
            center.place(relx=0.5, rely=0.5, anchor="center")
            tk.Label(center, text="LAPTOP LAB MANAGER", bg="#102d52", fg="#9fc8f4", font=("Segoe UI", 12, "bold")).pack(pady=(0, 20))
            title = "DAILY TIME ALLOWANCE REACHED" if self.limit_reached and not self.state.get("server_blocked", False) else "SESSION PAUSED BY ADMINISTRATOR"
            self.overlay_title = tk.Label(center, text=title, bg="#102d52", fg="white", font=("Segoe UI", 28, "bold"), wraplength=900, justify="center")
            self.overlay_title.pack(pady=10)
            tk.Label(center, text="This managed session is paused. Please contact the lab administrator.\nThe notice will close when the administrator restores access and the agent reconnects.", bg="#102d52", fg="#d1e3f8", font=("Segoe UI", 14), justify="center", wraplength=900).pack(pady=(12, 18))
            tk.Label(center, text="Developer: Raymond Apostol", bg="#102d52", fg="#8ca9c9", font=("Segoe UI", 10)).pack(pady=(12, 0))
            try:
                overlay.focus_force()
            except tk.TclError:
                pass
        elif active and self.pause_overlay is not None and self.pause_overlay.winfo_exists():
            if hasattr(self, "overlay_title"):
                title = "DAILY TIME ALLOWANCE REACHED" if self.limit_reached and not self.state.get("server_blocked", False) else "SESSION PAUSED BY ADMINISTRATOR"
                self.overlay_title.configure(text=title)
        elif not active and self.pause_overlay is not None:
            try:
                self.pause_overlay.destroy()
            except tk.TclError:
                pass
            self.pause_overlay = None
            try:
                self.root.deiconify()
                self.root.lift()
            except tk.TclError:
                pass

    def add_chat_line(self, sender: str, message: str):
        stamp = datetime.now().strftime("%H:%M")
        self.chat_list.insert(tk.END, f"{stamp}  {sender}: {message[:MAX_CHAT]}")
        self.chat_list.yview_moveto(1)
        self.local_chat_history.append((sender, message[:MAX_CHAT]))
        self.local_chat_history = self.local_chat_history[-80:]

    def send_reply(self):
        message = self.chat_input.get().strip()[:MAX_CHAT]
        if not message: return
        self.chat_input.delete(0, tk.END)
        threading.Thread(target=self.send_reply_network, args=(message,), daemon=True).start()

    def send_reply_network(self, message: str):
        try:
            request_json(self.server_url + "/api/device/chat", "POST", self.device_token, {"message": message})
            self.messages.put(("status", "Reply sent", True))
            self.messages.put(("message", f"(You replied) {message}"))
        except Exception:
            self.messages.put(("status", "Offline — reply was not sent", False))

    def network_loop(self):
        while not self.stop_event.is_set():
            try:
                if self.track_urls and time.monotonic() - self.last_url_scan >= 30:
                    self.recent_url = latest_browser_url()
                    self.last_url_scan = time.monotonic()
                payload = {
                    "username": getpass.getuser(),
                    "usage_minutes_today": min(1440, int(self.state.get("active_seconds", 0)) // 60),
                    "usage_day": date.today().isoformat(),
                    "recent_url": self.recent_url if self.track_urls else "",
                }
                heartbeat = request_json(self.server_url + "/api/device/heartbeat", "POST", self.device_token, payload)
                if heartbeat.get("state"):
                    self.messages.put(("state", heartbeat["state"]))
                polled = request_json(self.server_url + "/api/device/poll", "POST", self.device_token, {})
                if polled.get("state"):
                    self.messages.put(("state", polled["state"]))
                messages = polled.get("messages", [])
                for message in messages:
                    self.messages.put(("message", str(message.get("message", ""))[:MAX_CHAT]))
                if messages:
                    request_json(self.server_url + "/api/device/ack", "POST", self.device_token, {"message_ids": [str(m.get("id", "")) for m in messages]})
                self.messages.put(("status", "Connected to cloud administrator", True))
            except (urllib.error.URLError, TimeoutError, OSError, ValueError, RuntimeError) as exc:
                self.messages.put(("status", "Offline — using last saved rules", False))
            self.stop_event.wait(self.interval)

    def on_close(self):
        if messagebox.askyesno("Close client agent", "Close the lab management agent? The administrator will see this PC go offline and remote updates will stop until it is reopened."):
            self.stop_event.set()
            self.save_state()
            self.root.destroy()

    def run(self):
        if not self.server_url.startswith("https://") and "localhost" not in self.server_url and "127.0.0.1" not in self.server_url:
            messagebox.showerror("Configuration error", "For remote access, server_url must begin with https://. Edit agent_config.json and restart the agent.")
            return
        if not self.device_token or self.device_token.startswith("PASTE_"):
            messagebox.showerror("Configuration required", "Register this PC in the online admin dashboard, copy its one-time device token, and paste it into agent_config.json.")
            return
        if not self.pc_number or self.pc_number == "PC-UNSET":
            messagebox.showerror("Configuration required", "Set a unique pc_number in agent_config.json.")
            return
        self.network_thread = threading.Thread(target=self.network_loop, daemon=True)
        self.network_thread.start()
        self.root.mainloop()
        self.stop_event.set()


def main():
    if not CONFIG_PATH.exists():
        example = BASE_DIR / "agent_config.example.json"
        message = f"Create {CONFIG_PATH.name} using {example.name}, then add the PC number, Pages URL, and device token."
        try:
            root = tk.Tk(); root.withdraw(); messagebox.showerror("Agent configuration missing", message); root.destroy()
        except Exception: print(message, file=sys.stderr)
        return 2
    try:
        agent = LaptopAgent()
        agent.run()
        return 0
    except (tk.TclError, ValueError, TypeError, KeyError) as exc:
        messagebox.showerror("Agent startup error", f"Could not start the visible client agent. Check agent_config.json.\n\n{exc}")
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
