(() => {
  const $ = (id) => document.getElementById(id);
  const state = { token: "", devices: [], selectedId: "", refreshTimer: null, chatTimer: null, toastTimer: null, view: "overview", lastChatSignature: "" };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }
  function toast(message, isError = false) {
    const element = $("toast");
    element.textContent = message;
    element.className = `toast show${isError ? " error" : ""}`;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { element.className = "toast"; }, 3200);
  }
  async function api(path, options = {}) {
    const headers = { "content-type": "application/json", ...(options.headers || {}) };
    if (state.token) headers.authorization = `Bearer ${state.token}`;
    const response = await fetch(path, { ...options, headers, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && state.token && !path.endsWith("/login")) {
      signOut(false);
      throw new Error("Your session expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function showApp() {
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    document.title = "Laptop Lab Manager — Admin";
  }
  function showLogin() {
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
  }
  function signOut(showToast = true) {
    state.token = "";
    sessionStorage.removeItem("llm_session");
    clearInterval(state.refreshTimer);
    clearInterval(state.chatTimer);
    showLogin();
    if (showToast) toast("Signed out.");
  }
  async function login(event) {
    event.preventDefault();
    $("loginError").textContent = "";
    const button = $("loginForm").querySelector("button[type=submit]");
    button.disabled = true; button.textContent = "Signing in…";
    try {
      const result = await api("/api/admin/login", { method: "POST", headers: {}, body: JSON.stringify({ username: $("username").value.trim(), password: $("password").value }) });
      state.token = result.token;
      sessionStorage.setItem("llm_session", state.token);
      $("password").value = "";
      showApp();
      await refreshDevices();
      state.refreshTimer = setInterval(() => refreshDevices().catch((e) => { $("connectionText").textContent = "Connection issue"; }), 10000);
      state.chatTimer = setInterval(() => refreshChat(false).catch(() => {}), 5000);
    } catch (error) {
      $("loginError").textContent = error.message;
    } finally {
      button.disabled = false; button.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
    }
  }
  function minutes(n) { return `${Math.max(0, Number(n) || 0)} min`; }
  function statusBadge(d) {
    if (d.blocked) return '<span class="status blocked">● Blocked</span>';
    return d.online ? '<span class="status online">● Online</span>' : '<span class="status offline">● Offline</span>';
  }
  function deviceTableRow(d, full = false) {
    const used = Number(d.usage_minutes_today) || 0;
    const allowed = Number(d.allowance_minutes) || 0;
    const title = escapeHtml(d.recent_url || "—");
    const actions = full ? `
      <button class="mini-btn" data-action="set" data-id="${escapeHtml(d.id)}">Set time</button>
      <button class="mini-btn" data-action="plus10" data-id="${escapeHtml(d.id)}">+10m</button>
      <button class="mini-btn" data-action="plus30" data-id="${escapeHtml(d.id)}">+30m</button>
      <button class="mini-btn" data-action="plus60" data-id="${escapeHtml(d.id)}">+60m</button>
      <button class="mini-btn ${d.blocked ? "good" : "danger"}" data-action="${d.blocked ? "unblock" : "block"}" data-id="${escapeHtml(d.id)}">${d.blocked ? "Unblock" : "Block"}</button>
      <button class="mini-btn" data-action="chat" data-id="${escapeHtml(d.id)}">Chat</button>` : `
      <button class="mini-btn" data-action="set" data-id="${escapeHtml(d.id)}">Set time</button>
      <button class="mini-btn" data-action="plus10" data-id="${escapeHtml(d.id)}">+10m</button>
      <button class="mini-btn" data-action="plus30" data-id="${escapeHtml(d.id)}">+30m</button>
      <button class="mini-btn" data-action="plus60" data-id="${escapeHtml(d.id)}">+60m</button>
      <button class="mini-btn ${d.blocked ? "good" : "danger"}" data-action="${d.blocked ? "unblock" : "block"}" data-id="${escapeHtml(d.id)}">${d.blocked ? "Unblock" : "Block"}</button>
      <button class="mini-btn" data-action="chat" data-id="${escapeHtml(d.id)}">Chat</button>`;
    if (full) return `<tr><td><span class="pc-cell"><strong>${escapeHtml(d.pc_number)}</strong></span></td><td>${escapeHtml(d.computer_name)}</td><td>${escapeHtml(d.username || "—")}</td><td>${statusBadge(d)}</td><td>${minutes(used)}</td><td>${minutes(allowed)}</td><td>${d.blocked ? "Yes" : "No"}</td><td><span class="website" title="${title}">${title}</span></td></tr>`;
    return `<tr><td><span class="pc-cell"><strong>${escapeHtml(d.pc_number)}</strong><small>${escapeHtml(d.computer_name)}</small></span></td><td class="username">${escapeHtml(d.username || "—")}</td><td>${statusBadge(d)}</td><td><span class="usage">${used}<small> / ${allowed}m</small></span></td><td><span class="website" title="${title}">${title}</span></td><td><div class="row-actions">${actions}<button class="mini-btn" data-action="rotate_token" data-id="${escapeHtml(d.id)}">Reset token</button></div></td></tr>`;
  }
  async function refreshDevices() {
    if (!state.token) return;
    const data = await api("/api/admin/devices");
    state.devices = data.devices || [];
    $("connectionText").textContent = "Connected";
    $("statTotal").textContent = state.devices.length;
    $("statOnline").textContent = state.devices.filter((d) => d.online).length;
    $("statMinutes").textContent = state.devices.reduce((sum, d) => sum + (Number(d.usage_minutes_today) || 0), 0);
    $("statBlocked").textContent = state.devices.filter((d) => d.blocked).length;
    const query = $("searchInput").value.trim().toLowerCase();
    const filtered = state.devices.filter((d) => [d.pc_number, d.computer_name, d.username, d.recent_url].some((x) => String(x || "").toLowerCase().includes(query)));
    $("deviceRows").innerHTML = filtered.length ? filtered.map((d) => deviceTableRow(d)).join("") : '<tr><td colspan="6" class="empty">No matching PCs. Add a PC to begin enrollment.</td></tr>';
    $("computerRows").innerHTML = state.devices.length ? state.devices.map((d) => deviceTableRow(d, true)).join("") : '<tr><td colspan="8" class="empty">No PCs registered yet.</td></tr>';
    $("deviceCount").textContent = `${filtered.length} of ${state.devices.length} device${state.devices.length === 1 ? "" : "s"}`;
    $("lastUpdated").textContent = `Updated ${new Date().toLocaleTimeString()}`;
    const currentSelection = state.selectedId;
    $("chatDevice").innerHTML = '<option value="">Choose a PC…</option>' + state.devices.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.pc_number)} — ${escapeHtml(d.username || d.computer_name)}</option>`).join("");
    if (state.devices.some((d) => d.id === currentSelection)) $("chatDevice").value = currentSelection;
    else if (state.devices.length === 1) { state.selectedId = state.devices[0].id; $("chatDevice").value = state.selectedId; }
    await refreshChat(false).catch(() => {});
  }
  async function doAction(action, id, extra = {}) {
    try {
      const result = await api(`/api/admin/devices/${encodeURIComponent(id)}/commands`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
      if (action === "rotate_token") {
        $("addDeviceDialog").showModal();
        $("addDeviceForm").classList.add("hidden");
        $("tokenResult").classList.remove("hidden");
        $("tokenText").value = result.device_token;
        toast("Device token reset. Update the matching laptop configuration.");
      } else {
        toast(action === "message" ? "Message queued for delivery." : "PC settings updated.");
      }
      await refreshDevices();
      if (action === "message") await refreshChat(true);
    } catch (error) { toast(error.message, true); }
  }
  async function handleDeviceAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const device = state.devices.find((d) => d.id === id);
    if (!device) return;
    switch (button.dataset.action) {
      case "block": if (confirm(`Block the managed session on ${device.pc_number}?`)) await doAction("block", id); break;
      case "unblock": await doAction("unblock", id); break;
      case "plus10": await doAction("adjust_time", id, { delta: 10 }); break;
      case "plus30": await doAction("adjust_time", id, { delta: 30 }); break;
      case "plus60": await doAction("adjust_time", id, { delta: 60 }); break;
      case "set": {
        const answer = prompt(`Set the daily allowance for ${device.pc_number} in minutes (0–1440):`, String(device.allowance_minutes));
        if (answer === null) break;
        const minutes = Number(answer);
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) { toast("Enter a whole number from 0 to 1440.", true); break; }
        await doAction("set_allowance", id, { minutes }); break;
      }
      case "chat": state.selectedId = id; $("chatDevice").value = id; setView("overview"); await refreshChat(true); $("chatInput").focus(); break;
      case "rotate_token": if (confirm(`Reset the device token for ${device.pc_number}? The old token will stop working. You must replace the token in that laptop's agent_config.json.`)) await doAction("rotate_token", id); break;
    }
  }
  function setView(view) {
    state.view = view;
    for (const el of document.querySelectorAll(".view")) el.classList.add("hidden");
    $(`${view}View`).classList.remove("hidden");
    for (const nav of document.querySelectorAll(".nav-item[data-view]")) nav.classList.toggle("active", nav.dataset.view === view);
    const titles = { overview: ["Dashboard Overview", "Monitor registered laptops and manage active sessions."], computers: ["PC Monitoring", "Manage registrations, usage allowances, and session state."], messages: ["Message Center", "Review messages delivered to or received from laptop agents."] };
    $("pageTitle").textContent = titles[view][0];
    $("pageSubtitle").textContent = titles[view][1];
  }
  function openAddDialog() {
    $("addDeviceError").textContent = "";
    $("addDeviceForm").classList.remove("hidden");
    $("tokenResult").classList.add("hidden");
    $("newPcNumber").value = "";
    $("newComputerName").value = "";
    $("newAllowance").value = "60";
    $("addDeviceDialog").showModal();
  }
  async function addDevice(event) {
    event.preventDefault();
    $("addDeviceError").textContent = "";
    try {
      const result = await api("/api/admin/devices", { method: "POST", body: JSON.stringify({ pc_number: $("newPcNumber").value.trim(), computer_name: $("newComputerName").value.trim(), allowance_minutes: Number($("newAllowance").value) }) });
      $("addDeviceForm").classList.add("hidden");
      $("tokenResult").classList.remove("hidden");
      $("tokenText").value = result.device_token;
      await refreshDevices();
      toast(`${result.device.pc_number} registered. Copy its token now.`);
    } catch (error) { $("addDeviceError").textContent = error.message; }
  }
  async function refreshChat(showError = true) {
    if (!state.token || !state.selectedId) {
      $("chatLog").innerHTML = '<div class="chat-empty">Select a PC to view messages.</div>';
      $("messageCenter").innerHTML = '<p class="muted">Select a PC from the Messages panel on the dashboard.</p>';
      return;
    }
    try {
      const data = await api(`/api/admin/devices/${encodeURIComponent(state.selectedId)}/chat`);
      const messages = data.messages || [];
      const signature = messages.map((m) => m.id).join(":");
      const render = messages.length ? messages.map((m) => `<div class="chat-msg ${m.sender === "admin" ? "admin" : "client"}">${escapeHtml(m.message)}<small>${m.sender === "admin" ? "Admin" : "Laptop"} · ${escapeHtml(new Date(m.created_at).toLocaleString())}${m.sender === "admin" && !m.delivered_at ? " · Queued" : ""}</small></div>`).join("") : '<div class="chat-empty">No messages yet.</div>';
      $("chatLog").innerHTML = render;
      $("chatLog").scrollTop = $("chatLog").scrollHeight;
      const pc = state.devices.find((d) => d.id === state.selectedId);
      $("messageCenter").innerHTML = `<h3>${escapeHtml(pc ? pc.pc_number : "Selected PC")}</h3><div class="chat-log">${render}</div>`;
      if (signature !== state.lastChatSignature) state.lastChatSignature = signature;
    } catch (error) { if (showError) toast(error.message, true); }
  }
  async function sendMessage(event) {
    event.preventDefault();
    if (!state.selectedId) return toast("Choose a PC first.", true);
    const message = $("chatInput").value.trim();
    if (!message) return;
    await doAction("message", state.selectedId, { message });
    $("chatInput").value = "";
  }

  $("loginForm").addEventListener("submit", login);
  $("logoutBtn").addEventListener("click", () => signOut());
  $("addDeviceBtn").addEventListener("click", openAddDialog);
  $("addDeviceBtn2").addEventListener("click", openAddDialog);
  $("closeAddDialog").addEventListener("click", () => $("addDeviceDialog").close());
  $("doneTokenBtn").addEventListener("click", () => $("addDeviceDialog").close());
  $("addDeviceForm").addEventListener("submit", addDevice);
  $("copyTokenBtn").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("tokenText").value); toast("Device token copied."); } catch { $("tokenText").select(); document.execCommand("copy"); toast("Copy the selected token into the client configuration."); } });
  $("refreshBtn").addEventListener("click", () => refreshDevices().then(() => toast("Dashboard refreshed.")).catch((e) => toast(e.message, true)));
  $("searchInput").addEventListener("input", () => refreshDevices().catch(() => {}));
  $("deviceRows").addEventListener("click", handleDeviceAction);
  $("computerRows").addEventListener("click", handleDeviceAction);
  $("chatDevice").addEventListener("change", async (event) => { state.selectedId = event.target.value; state.lastChatSignature = ""; await refreshChat(true); });
  $("chatForm").addEventListener("submit", sendMessage);
  for (const nav of document.querySelectorAll(".nav-item[data-view]")) nav.addEventListener("click", () => setView(nav.dataset.view));

  const remembered = sessionStorage.getItem("llm_session");
  if (remembered) {
    state.token = remembered;
    showApp();
    refreshDevices().then(() => {
      state.refreshTimer = setInterval(() => refreshDevices().catch(() => { $("connectionText").textContent = "Connection issue"; }), 10000);
      state.chatTimer = setInterval(() => refreshChat(false).catch(() => {}), 5000);
    }).catch(() => signOut(false));
  }
})();
