(function () {
  function $(id) { return document.getElementById(id); }
  function api(url, opt) {
    return fetch(url, opt || {}).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok && j && j.error) throw new Error(j.error);
        return j;
      });
    });
  }
  var probeState = { db: false, dest: false };
  function toast(msg, ok) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "toast " + (ok ? "ok" : "bad");
    setTimeout(function () { t.className = "toast hidden"; }, 2800);
  }
  function toggleDest() {
    var m = $("dest_mode") && $("dest_mode").value;
    ["local", "s3", "azure", "webdav", "sftp"].forEach(function (k) {
      var el = $("dest-" + k);
      if (el) el.classList.toggle("hidden", m !== k);
    });
  }
  function destPayload() {
    return {
      mode: $("dest_mode").value,
      local_dir: ($("local_dir") || {}).value || "",
      s3_endpoint: ($("s3_endpoint") || {}).value || "",
      s3_region: ($("s3_region") || {}).value || "",
      s3_bucket: ($("s3_bucket") || {}).value || "",
      s3_prefix: ($("s3_prefix") || {}).value || "",
      s3_access_key: ($("s3_access_key") || {}).value || "",
      s3_secret_key: ($("s3_secret_key") || {}).value || "",
      azure_account: ($("azure_account") || {}).value || "",
      azure_container: ($("azure_container") || {}).value || "",
      azure_key: ($("azure_key") || {}).value || "",
      azure_prefix: ($("azure_prefix") || {}).value || "",
      webdav_url: ($("webdav_url") || {}).value || "",
      webdav_user: ($("webdav_user") || {}).value || "",
      webdav_password: ($("webdav_password") || {}).value || "",
      sftp_host: ($("sftp_host") || {}).value || "",
      sftp_user: ($("sftp_user") || {}).value || "",
      sftp_password: ($("sftp_password") || {}).value || "",
      sftp_key_file: ($("sftp_key_file") || {}).value || "",
      sftp_path: ($("sftp_path") || {}).value || "",
      sftp_insecure: !!($("sftp_insecure") && $("sftp_insecure").checked)
    };
  }
  function bodyFromForm() {
    return {
      name: ($("name") || {}).value || "",
      schedule: ($("schedule") || {}).value || "0 3 * * *",
      retention: Number(($("retention") || {}).value) || 14,
      license: { token: ($("token") || {}).value || "" },
      database: {
        type: ($("db_type") || {}).value || "postgres",
        uri: ($("db_uri") || {}).value || "",
        backup_type: ($("backup_type") || {}).value || "full"
      },
      destination: destPayload(),
      security: { encrypt: !!($("encrypt") && $("encrypt").checked) },
      terms_accepted: !!($("terms_accept") && $("terms_accept").checked)
    };
  }
  function setStep(n) {
    document.querySelectorAll(".step").forEach(function (b) {
      b.classList.toggle("on", Number(b.getAttribute("data-step")) === n);
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("on", p.getAttribute("data-panel") === String(n));
    });
  }
  document.querySelectorAll(".step").forEach(function (b) {
    b.addEventListener("click", function () { setStep(Number(b.getAttribute("data-step"))); });
  });
  if ($("dest_mode")) $("dest_mode").addEventListener("change", toggleDest);
  if ($("btn-test-db")) $("btn-test-db").addEventListener("click", function () {
    api("/api/test-db", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: $("db_type").value, uri: $("db_uri").value.trim() }) })
      .then(function (j) { probeState.db = !!j.ok; toast(j.ok ? "Database OK" : (j.detail || "Failed"), !!j.ok); if ($("db-probe-msg")) $("db-probe-msg").textContent = j.detail || (j.ok ? "OK" : "Failed"); })
      .catch(function (e) { toast(String(e.message || e), false); });
  });
  if ($("btn-test-dest")) $("btn-test-dest").addEventListener("click", function () {
    api("/api/test-dest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(destPayload()) })
      .then(function (j) { probeState.dest = !!j.ok; toast(j.ok ? "Destination OK" : (j.detail || "Failed"), !!j.ok); if ($("dest-probe-msg")) $("dest-probe-msg").textContent = j.detail || (j.ok ? "OK" : "Failed"); })
      .catch(function (e) { toast(String(e.message || e), false); });
  });
  if ($("btn-save")) $("btn-save").addEventListener("click", function () {
    if (!probeState.db) { toast("Test database first", false); return; }
    if (!probeState.dest) { toast("Test destination first", false); return; }
    api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyFromForm()) })
      .then(function (j) { toast(j.ok ? "Saved" : "Save failed", !!j.ok); })
      .catch(function (e) { toast(String(e.message || e), false); });
  });
  if ($("btn-run")) $("btn-run").addEventListener("click", function () {
    api("/api/run-once", { method: "POST" }).then(function () { toast("Backup started", true); }).catch(function (e) { toast(String(e.message || e), false); });
  });
  if ($("btn-license")) $("btn-license").addEventListener("click", function () {
    api("/api/test-license", { method: "POST" }).then(function (j) { toast(j.allowed || j.ok ? "License OK" : (j.reason || "Failed"), !!(j.allowed || j.ok)); });
  });
  function refreshStorage() {
    var box = $("storage-list");
    if (!box) return;
    api("/api/backups").then(function (j) {
      var objs = j.objects || [];
      if (!objs.length) { box.textContent = "No backup objects found."; return; }
      box.innerHTML = "";
      objs.forEach(function (o) {
        var row = document.createElement("div");
        row.className = "stor-row";
        row.textContent = (o.key || o.Key || "") + " · " + (o.size || o.Size || 0) + " bytes";
        var del = document.createElement("button");
        del.type = "button"; del.className = "btn btn-ghost"; del.textContent = "Delete";
        del.onclick = function () {
          if (!confirm("Delete?")) return;
          api("/api/backups/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: o.key || o.Key }) })
            .then(function () { toast("Deleted", true); refreshStorage(); })
            .catch(function (e) { toast(e.message || "Failed", false); });
        };
        var rest = document.createElement("button");
        rest.type = "button"; rest.className = "btn btn-ghost"; rest.textContent = "Restore";
        rest.onclick = function () {
          api("/api/backups/get", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: o.key || o.Key, decrypt: true }) })
            .then(function (r) { toast("Restored to " + (r.local_path || "work dir"), true); })
            .catch(function (e) { toast(e.message || "Failed", false); });
        };
        row.appendChild(rest); row.appendChild(del); box.appendChild(row);
      });
    }).catch(function (e) { box.textContent = "List failed: " + (e.message || e); });
  }
  if ($("btn-refresh-storage")) $("btn-refresh-storage").addEventListener("click", refreshStorage);
  api("/api/config").then(function (j) {
    var c = j.config || {};
    if (c.name && $("name")) $("name").value = c.name;
    if (c.schedule && $("schedule")) $("schedule").value = c.schedule;
    if (c.database) {
      if (c.database.type && $("db_type")) $("db_type").value = c.database.type;
      if (c.database.uri && $("db_uri")) $("db_uri").value = c.database.uri;
    }
    if (c.destination) {
      if (c.destination.mode && $("dest_mode")) $("dest_mode").value = c.destination.mode;
      if (c.destination.local_dir && $("local_dir")) $("local_dir").value = c.destination.local_dir;
      if ($("sftp_insecure") && typeof c.destination.sftp_insecure === "boolean") $("sftp_insecure").checked = !!c.destination.sftp_insecure;
      ["sftp_host","sftp_user","sftp_path","s3_bucket","s3_endpoint","webdav_url","azure_account"].forEach(function (k) {
        if (c.destination[k] && $(k)) $(k).value = c.destination[k];
      });
    }
    toggleDest();
  }).catch(function () {});
  function refreshStatus() {
    api("/api/status").then(function (j) {
      if ($("status")) $("status").textContent = JSON.stringify(j, null, 2);
      if ($("status-pill")) $("status-pill").textContent = j.licenseOk ? "License OK" : "License";
    }).catch(function () {});
  }
  function refreshHistory() {
    api("/api/history").then(function (j) {
      var list = j.history || [];
      if ($("history")) $("history").innerHTML = list.map(function (e) {
        return "<div>" + (e.status || "") + " " + (e.code ? e.code + " " : "") + (e.started || "") + " " + (e.error || e.message || "") + "</div>";
      }).join("") || "No history";
    }).catch(function () {});
  }
  ["next-1","next-2","next-3"].forEach(function (id, i) {
    if ($(id)) $(id).addEventListener("click", function () { setStep(i + 2); });
  });
  ["back-2","back-3","back-4"].forEach(function (id, i) {
    if ($(id)) $(id).addEventListener("click", function () { setStep(i + 1); });
  });
  toggleDest();
  refreshStatus();
  refreshHistory();
  refreshStorage();
  setInterval(function () { refreshStatus(); refreshHistory(); }, 8000);
})();
