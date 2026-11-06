(function () {
  "use strict";

  if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
  }

  const state = {
    stats: null,
    allNodes: [],
    filteredNodes: [],
    donorSort: "active",
    donorQuery: "",
    selectedCountry: "ALL",
    selectedProtocol: "ALL",
    nodeQuery: "",
    visibleLimit: 80,
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function extractOriginalTag(link, kindOrProto) {
    if (!link) return "Untagged";
    if (link.startsWith("vmess://")) {
      try {
        const b64 = link.slice(8).split("#")[0].replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        const decoded = JSON.parse(decodeURIComponent(escape(atob(padded))));
        if (decoded && decoded.ps) return String(decoded.ps).trim();
      } catch (_) {}
    }
    const hashIndex = link.indexOf("#");
    if (hashIndex !== -1 && hashIndex < link.length - 1) {
      const rawTag = link.slice(hashIndex + 1);
      try {
        return decodeURIComponent(rawTag).trim();
      } catch (_) {
        return rawTag.trim();
      }
    }
    return kindOrProto ? `${kindOrProto.toUpperCase()} Node` : "Untagged";
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove("show"), 2000);
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(label || "Copied to clipboard");
    } catch (_) {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      showToast(label || "Copied to clipboard");
    }
  }

  function telegramImportUrl(link) {
    try {
      const parsed = new URL(String(link || "").trim());
      let kind = "";
      let params;

      if (parsed.protocol === "tg:") {
        kind = parsed.hostname.toLowerCase();
        params = new URLSearchParams(parsed.search);
      } else if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        (parsed.hostname === "t.me" || parsed.hostname === "www.t.me")
      ) {
        kind = parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
        params = new URLSearchParams(parsed.search);
      } else {
        return null;
      }

      if (!["proxy", "socks"].includes(kind)) return null;
      if (!params.get("server") || !params.get("port")) return null;
      if (kind === "proxy" && !params.get("secret")) return null;

      return `https://t.me/${kind}?${params.toString()}`;
    } catch (_) {
      return null;
    }
  }

  function pingClass(ms) {
    if (!ms || ms <= 0) return "";
    if (ms < 250) return "ping-good";
    if (ms < 600) return "ping-mid";
    return "ping-high";
  }

  function renderKpis() {
    const summary = (state.stats && state.stats.summary) || {};
    document.getElementById("kpi-configs").textContent = (summary.active_configs || 0).toLocaleString();
    document.getElementById("kpi-proxies").textContent = (summary.active_proxies || 0).toLocaleString();
    document.getElementById("kpi-countries").textContent = (summary.countries_count || 0).toLocaleString();
    document.getElementById("kpi-donors").textContent = (summary.total_donors || 0).toLocaleString();

    const updatedRaw = (state.stats && state.stats.updated_at) || "";
    const updatedEl = document.getElementById("updated-at");
    if (updatedRaw) {
      updatedEl.textContent = updatedRaw.replace("T", " ").slice(0, 16);
    } else {
      updatedEl.textContent = "Live";
    }
  }

  function renderDonors() {
    const tbody = document.getElementById("donors-tbody");
    const list = ((state.stats && state.stats.leaderboard) || []).slice();
    const q = state.donorQuery.trim().toLowerCase();

    list.sort((a, b) => {
      if (state.donorSort === "total") {
        return (b.verified_total || 0) - (a.verified_total || 0) || (b.active_total || 0) - (a.active_total || 0);
      }
      return (b.active_total || 0) - (a.active_total || 0) || (b.verified_total || 0) - (a.verified_total || 0);
    });

    const filtered = list.filter((d) => {
      if (!q) return true;
      return (
        String(d.name || "").toLowerCase().includes(q) ||
        String(d.handle || "").toLowerCase().includes(q)
      );
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No verified donors match your filter.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered
      .map((d, idx) => {
        const rank = idx + 1;
        const rankCls = rank <= 3 ? `rank-badge rank-${rank}` : "rank-badge";
        const donorId = d.user_id != null ? String(d.user_id) : "";
        const profileUrl = donorId ? `tg://user?id=${encodeURIComponent(donorId)}` : "";
        const donorName = escapeHtml(d.name || "Unknown user");
        return `
          <tr>
            <td class="col-rank"><span class="${rankCls}">${rank}</span></td>
            <td>
              <div class="donor-cell">
                ${profileUrl
                  ? `<a class="donor-name donor-profile-link" href="${profileUrl}" title="Open Telegram profile">${donorName}</a>`
                  : `<span class="donor-name">${donorName}</span>`}
                ${d.handle ? `<span class="donor-handle">${escapeHtml(d.handle)}</span>` : ""}
                ${donorId ? `<span class="donor-id">ID ${escapeHtml(donorId)}</span>` : ""}
              </div>
            </td>
            <td class="num ping-good">${(d.active_total || 0).toLocaleString()}</td>
            <td class="num">${(d.verified_total || 0).toLocaleString()}</td>
            <td class="num hide-sm">${(d.verified_configs || 0).toLocaleString()}</td>
            <td class="num hide-sm">${(d.verified_subs || 0).toLocaleString()}</td>
            <td class="num hide-sm">${(d.verified_files || 0).toLocaleString()}</td>
            <td class="num hide-sm">${(d.verified_proxies || 0).toLocaleString()}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderExplorerFilters() {
    const countryWrap = document.getElementById("country-pills");
    const protoWrap = document.getElementById("protocol-pills");

    const countryCounts = {};
    const protoCounts = {};

    for (const node of state.allNodes) {
      countryCounts[node.country_code] = (countryCounts[node.country_code] || 0) + 1;
      protoCounts[node.protocol] = (protoCounts[node.protocol] || 0) + 1;
    }

    const sortedCountries = Object.keys(countryCounts).sort((a, b) => countryCounts[b] - countryCounts[a]);
    const sortedProtos = Object.keys(protoCounts).sort((a, b) => protoCounts[b] - protoCounts[a]);

    const cButtons = [
      `<button class="pill ${state.selectedCountry === "ALL" ? "active" : ""}" data-country="ALL">ALL (${state.allNodes.length})</button>`,
      ...sortedCountries.map(
        (code) =>
          `<button class="pill ${state.selectedCountry === code ? "active" : ""}" data-country="${escapeHtml(code)}">${escapeHtml(code)} (${countryCounts[code]})</button>`
      ),
    ];
    countryWrap.innerHTML = cButtons.join("");

    const pButtons = [
      `<button class="pill ${state.selectedProtocol === "ALL" ? "active" : ""}" data-proto="ALL">ALL</button>`,
      ...sortedProtos.map(
        (proto) =>
          `<button class="pill ${state.selectedProtocol === proto ? "active" : ""}" data-proto="${escapeHtml(proto)}">${escapeHtml(proto.toUpperCase())} (${protoCounts[proto]})</button>`
      ),
    ];
    protoWrap.innerHTML = pButtons.join("");
  }

  function applyNodeFilters() {
    const q = state.nodeQuery.trim().toLowerCase();
    state.filteredNodes = state.allNodes.filter((n) => {
      if (state.selectedCountry !== "ALL" && n.country_code !== state.selectedCountry) return false;
      if (state.selectedProtocol !== "ALL" && n.protocol !== state.selectedProtocol) return false;
      if (q) {
        const hay = `${n.tag} ${n.country_code} ${n.country_name} ${n.protocol}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const copyBtn = document.getElementById("copy-filtered-btn");
    if (copyBtn) {
      copyBtn.textContent = `Copy Filtered (${state.filteredNodes.length})`;
    }
    renderNodesTable();
  }

  function renderNodesTable() {
    const tbody = document.getElementById("nodes-tbody");
    const moreWrap = document.getElementById("load-more-wrap");
    if (!state.filteredNodes.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No verified nodes match the current filter.</td></tr>';
      moreWrap.style.display = "none";
      return;
    }
    const slice = state.filteredNodes.slice(0, state.visibleLimit);
    tbody.innerHTML = slice.map((n, idx) => {
      const telegramUrl = telegramImportUrl(n.link);
      const latency = n.ping_ms ? `${Number(n.ping_ms).toFixed(1)} ms <span class="latency-kind">${escapeHtml(n.ping_type || "Latency")}</span>` : "—";
      return `
        <tr>
          <td><div class="badge-country"><span class="country-iso">${escapeHtml(n.country_code)}</span><span>${escapeHtml(n.country_name)}</span></div></td>
          <td><span class="badge-proto">${escapeHtml(n.protocol)}</span></td>
          <td class="tag-cell" title="${escapeHtml(n.tag)}">${escapeHtml(n.tag)}</td>
          <td class="num ${pingClass(n.ping_ms)}">${latency}</td>
          <td class="col-action"><div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;white-space:nowrap">
            <button class="btn-copy" data-node-idx="${idx}" type="button">Copy</button>
            ${telegramUrl ? `<a class="btn-copy" style="display:inline-flex;align-items:center;text-decoration:none" href="${escapeHtml(telegramUrl)}" target="_blank" rel="noopener noreferrer" title="Import this proxy in Telegram">Telegram</a>` : ""}
          </div></td>
        </tr>`;
    }).join("");
    moreWrap.style.display = state.filteredNodes.length > state.visibleLimit ? "flex" : "none";
  }

  function renderRadar() {
    const summary = (state.stats && state.stats.summary) || {};
    const countries = summary.countries || [];
    const protocols = summary.protocols || {};

    const cBody = document.getElementById("countries-tbody");
    if (!countries.length) {
      cBody.innerHTML = '<tr><td colspan="4" class="empty-cell">No location data available.</td></tr>';
    } else {
      cBody.innerHTML = countries
        .map(
          (c) => `
          <tr class="clickable-row" data-jump-country="${escapeHtml(c.code)}">
            <td>
              <div class="badge-country">
                <span class="country-iso">${escapeHtml(c.code)}</span>
                <span>${escapeHtml(c.name)}</span>
              </div>
            </td>
            <td class="num">${(c.configs_count || 0).toLocaleString()}</td>
            <td class="num">${(c.proxies_count || 0).toLocaleString()}</td>
            <td class="num country-latency">CFG ${c.avg_config_ping ? `${Number(c.avg_config_ping).toFixed(1)} ms` : "—"}<br>PROXY ${c.avg_proxy_ping ? `${Number(c.avg_proxy_ping).toFixed(1)} ms` : "—"}</td>
          </tr>
        `
        )
        .join("");
    }

    const pWrap = document.getElementById("protocols-list");
    const entries = Object.entries(protocols).sort((a, b) => b[1] - a[1]);
    const totalProto = entries.reduce((acc, item) => acc + item[1], 0) || 1;

    if (!entries.length) {
      pWrap.innerHTML = '<div class="empty-cell">No protocol metrics available.</div>';
    } else {
      pWrap.innerHTML = entries
        .map(([proto, count]) => {
          const pct = Math.max(2, Math.round((count / totalProto) * 100));
          return `
            <div class="proto-row">
              <div class="proto-row-head">
                <span>${escapeHtml(proto.toUpperCase())}</span>
                <span>${count.toLocaleString()} (${pct}%)</span>
              </div>
              <div class="proto-track">
                <div class="proto-fill" style="width: ${pct}%"></div>
              </div>
            </div>
          `;
        })
        .join("");
    }
  }

  function switchTab(tabName) {
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `tab-${tabName}`);
    });
  }

  function bindEvents() {
    document.querySelectorAll(".nav-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    document.getElementById("donor-sort-group").addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      state.donorSort = btn.dataset.sort;
      document.querySelectorAll("#donor-sort-group .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderDonors();
    });

    document.getElementById("donor-search").addEventListener("input", (e) => {
      state.donorQuery = e.target.value;
      renderDonors();
    });

    document.getElementById("node-search").addEventListener("input", (e) => {
      state.nodeQuery = e.target.value;
      state.visibleLimit = 80;
      applyNodeFilters();
    });

    document.getElementById("country-pills").addEventListener("click", (e) => {
      const pill = e.target.closest(".pill");
      if (!pill) return;
      state.selectedCountry = pill.dataset.country;
      state.visibleLimit = 80;
      renderExplorerFilters();
      applyNodeFilters();
    });

    document.getElementById("protocol-pills").addEventListener("click", (e) => {
      const pill = e.target.closest(".pill");
      if (!pill) return;
      state.selectedProtocol = pill.dataset.proto;
      state.visibleLimit = 80;
      renderExplorerFilters();
      applyNodeFilters();
    });

    document.getElementById("nodes-tbody").addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-copy");
      if (!btn) return;
      const idx = Number(btn.dataset.nodeIdx);
      const node = state.filteredNodes[idx];
      if (node && node.link) {
        copyText(node.link, `Copied ${node.protocol.toUpperCase()} node`);
      }
    });

    document.getElementById("copy-filtered-btn").addEventListener("click", () => {
      if (!state.filteredNodes.length) return;
      const payload = state.filteredNodes.map((n) => n.link).join("\n");
      copyText(payload, `Copied ${state.filteredNodes.length} nodes`);
    });

    const copySubXrayBtn = document.getElementById("copy-sub-xray-btn");
    if (copySubXrayBtn) {
      copySubXrayBtn.addEventListener("click", () => {
        const xrayUrl = new URL("xray_final.txt", window.location.href).href;
        copyText(xrayUrl, "Copied Xray Subscription URL");
      });
    }

    const copySubProxyBtn = document.getElementById("copy-sub-proxy-btn");
    if (copySubProxyBtn) {
      copySubProxyBtn.addEventListener("click", () => {
        const proxyUrl = new URL("working_proxies.txt", window.location.href).href;
        copyText(proxyUrl, "Copied Proxies List URL");
      });
    }

    const copyAllNodesBtn = document.getElementById("copy-all-nodes-btn");
    if (copyAllNodesBtn) {
      copyAllNodesBtn.addEventListener("click", () => {
        if (!state.allNodes.length) {
          showToast("No active nodes available");
          return;
        }
        const payload = state.allNodes.map((n) => n.link).join("\n");
        copyText(payload, `Copied ${state.allNodes.length} active nodes`);
      });
    }

    document.getElementById("load-more-btn").addEventListener("click", () => {
      state.visibleLimit += 80;
      renderNodesTable();
    });

    document.getElementById("countries-tbody").addEventListener("click", (e) => {
      const row = e.target.closest("[data-jump-country]");
      if (!row) return;
      state.selectedCountry = row.dataset.jumpCountry;
      state.visibleLimit = 80;
      renderExplorerFilters();
      applyNodeFilters();
      switchTab("explorer");
    });
  }

  async function init() {
    bindEvents();
    const bust = `t=${Math.floor(Date.now() / 60000)}`;
    try {
      const [statsRes, configsRes] = await Promise.all([
        fetch(`./data/stats.json?${bust}`),
        fetch(`./data/configs.json?${bust}`),
      ]);

      if (statsRes.ok) {
        state.stats = await statsRes.json();
      }
      if (configsRes.ok) {
        const cfgData = await configsRes.json();
        const cfgs = (cfgData.configs || []).map((c) => ({
          link: c.link,
          protocol: String(c.protocol || "xray").toLowerCase(),
          country_code: String(c.country_code || "UN").toUpperCase(),
          country_name: String(c.country_name || "Location unavailable"),
          ping_ms: Number(c.ping_ms || 0),
          ping_type: String(c.ping_type || "HTTP tunnel"),
          tag: extractOriginalTag(c.link, c.protocol),
        }));
        const prxs = (cfgData.proxies || []).map((p) => {
          const kindOrProto = String(p.kind || p.protocol || "proxy").toLowerCase();
          return {
            link: p.link,
            protocol: kindOrProto,
            country_code: String(p.country_code || "UN").toUpperCase(),
            country_name: String(p.country_name || "Location unavailable"),
            ping_ms: Number(p.ping_ms || 0),
            ping_type: String(p.ping_type || (kindOrProto === "socks" ? "SOCKS tunnel" : "TCP connect")),
            tag: p.link && p.link.includes("#") ? extractOriginalTag(p.link, kindOrProto) : `Telegram ${kindOrProto.toUpperCase()}`,
          };
        });
        state.allNodes = [...cfgs, ...prxs].sort((a, b) => (a.ping_ms || 9999) - (b.ping_ms || 9999));
      }

      renderKpis();
      renderDonors();
      renderExplorerFilters();
      applyNodeFilters();
      renderRadar();
    } catch (err) {
      console.error("Failed to load collector data:", err);
      document.getElementById("updated-at").textContent = "Offline";
    }
  }

  init();
})();