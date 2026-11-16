(function () {
  function $(id) { return document.getElementById(id); }
  function api(url, opt) {
    return fetch(url, opt || {}).then(function (r) { return r.json(); });
  }
  var probeState = { db: false, dest: false };

  function toast(msg, ok) {
    var t = $("toast");
    t.textContent = msg;
    t.className = ok ? "ok" : "bad";
    setTimeout(function () { t.className = "hidden"; }, 2500);
  }

  function setStep(n) {
    document.querySelectorAll(".step").forEach(function (b) {
      b.classList.toggle("on", Number(b.getAttribute("data-step")) === n);
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("on", p.getAttribute("data-panel") === String(n));
    });
    if (n === 4) {
      fillReview();
      refreshReviewProbeMsg();
    }
  }

  document.querySelectorAll(".step").forEach(function (b) {
    b.addEventListener("click", function () {
      setStep(Number(b.getAttribute("data-step")));
    });
  });

  $("next-1").addEventListener("click", function () { setStep(2); });
  $("next-2").addEventListener("click", function () {
    if (!probeState.db) { toast("Test database first", false); return; }
    setStep(3);
  });
  $("next-3").addEventListener("click", function () {
    if (!probeState.dest) { toast("Test destination first", false); return; }
    setStep(4);
  });
  $("back-2").addEventListener("click", function () { setStep(1); });
  $("back-3").addEventListener("click", function () { setStep(2); });
  $("back-4").addEventListener("click", function () { setStep(3); });

  function toggleDest() {
    var m = $("dest_mode").value;
    ["local", "s3", "azure", "webdav", "sftp"].forEach(function (k) {
      var el = $("dest-" + k);
      if (el) el.classList.toggle("hidden", m !== k);
    });
  }
  $("dest_mode").addEventListener("change", function () {
    toggleDest();
    probeState.dest = false;
    setDestProbe("", "Test the destination before saving.");
  });

  function refreshReviewProbeMsg() {
    var el = $("review-probe-msg");
    var box = $("review-probes");
    if (!el || !box) return;
    box.classList.remove("ok", "bad");
    if (probeState.db && probeState.dest) {
      box.classList.add("ok");
      el.textContent = "Database and destination tests passed — you can save.";
    } else {
      box.classList.add("bad");
      var missing = [];
      if (!probeState.db) missing.push("database");
      if (!probeState.dest) missing.push("destination");
      el.textContent = "Still need successful test(s): " + missing.join(" and ") + ".";
    }
  }

  function setProbe(state, msg) {
    var box = $("db-probe");
    var el = $("db-probe-msg");
    box.classList.remove("ok", "bad", "busy");
    if (state) box.classList.add(state);
    el.textContent = msg;
    if (state === "ok") probeState.db = true;
    else if (state === "bad" || state === "busy") probeState.db = false;
    refreshReviewProbeMsg();
  }

  function setDestProbe(state, msg) {
    var box = $("dest-probe");
    var el = $("dest-probe-msg");
    box.classList.remove("ok", "bad", "busy");
    if (state) box.classList.add(state);
    el.textContent = msg;
    if (state === "ok") probeState.dest = true;
    else if (state === "bad" || state === "busy") probeState.dest = false;
    refreshReviewProbeMsg();
  }

  function runDbTest(btn) {
    var type = $("db_type").value;
    var uri = $("db_uri").value.trim();
    if (!uri) {
      setProbe("bad", "Enter a connection URI first.");
      toast("Connection URI is required", false);
      return;
    }
    if (btn) btn.disabled = true;
    setProbe("busy", "Testing…");
    api("/api/test-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type, uri: uri })
    }).then(function (j) {
      if (j.ok) {
        setProbe("ok", "Reachable" + (j.detail ? " · " + j.detail : ""));
        toast("Database reachable", true);
      } else {
        setProbe("bad", j.detail || j.status || "Failed");
        toast(j.detail || "Failed", false);
      }
    }).catch(function (e) {
      setProbe("bad", String(e));
      toast(String(e), false);
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function runDestTest(btn) {
    var payload = {
      mode: $("dest_mode").value,
      local_dir: $("local_dir").value.trim(),
      s3_endpoint: $("s3_endpoint").value.trim(),
      s3_region: $("s3_region").value.trim(),
      s3_bucket: $("s3_bucket").value.trim(),
      s3_prefix: $("s3_prefix").value.trim(),
      s3_access_key: $("s3_access_key").value.trim(),
      s3_secret_key: $("s3_secret_key").value.trim(),
      azure_account: $("azure_account").value.trim(),
      azure_container: $("azure_container").value.trim(),
      azure_key: $("azure_key").value.trim(),
      azure_prefix: $("azure_prefix").value.trim(),
      webdav_url: $("webdav_url").value.trim(),
      webdav_user: $("webdav_user").value.trim(),
      webdav_password: $("webdav_password").value.trim(),
      sftp_host: $("sftp_host").value.trim(),
      sftp_user: $("sftp_user").value.trim(),
      sftp_password: $("sftp_password").value.trim(),
      sftp_key_file: $("sftp_key_file").value.trim(),
      sftp_path: $("sftp_path").value.trim(),
      sftp_insecure: !!($("sftp_insecure") && $("sftp_insecure").checked)
    };
    if (btn) btn.disabled = true;
    setDestProbe("busy", "Testing destination…");
    api("/api/test-dest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (j) {
      if (j.ok) {
        setDestProbe("ok", "Reachable" + (j.detail ? " · " + j.detail : ""));
        toast("Destination reachable", true);
      } else {
        setDestProbe("bad", j.detail || j.status || "Failed");
        toast(j.detail || "Failed", false);
      }
    }).catch(function (e) {
      setDestProbe("bad", String(e));
      toast(String(e), false);
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  $("btn-test-db").addEventListener("click", function () { runDbTest($("btn-test-db")); });
  $("btn-test-dest").addEventListener("click", function () { runDestTest($("btn-test-dest")); });
  if ($("btn-review-test-db")) {
    $("btn-review-test-db").addEventListener("click", function () { runDbTest($("btn-review-test-db")); });
  }
  if ($("btn-review-test-dest")) {
    $("btn-review-test-dest").addEventListener("click", function () { runDestTest($("btn-review-test-dest")); });
  }

  function bodyFromForm() {
    return {
      name: $("name").value.trim(),
      schedule: $("schedule").value.trim() || "0 3 * * *",
      retention: Number($("retention").value) || 14,
      license: { token: $("token").value.trim() },
      database: {
        type: $("db_type").value,
        uri: $("db_uri").value.trim(),
        backup_type: $("backup_type").value
      },
      destination: {
        mode: $("dest_mode").value,
        local_dir: $("local_dir").value.trim(),
        s3_endpoint: $("s3_endpoint").value.trim(),
        s3_region: $("s3_region").value.trim(),
        s3_bucket: $("s3_bucket").value.trim(),
        s3_prefix: $("s3_prefix").value.trim(),
        s3_access_key: $("s3_access_key").value.trim(),
        s3_secret_key: $("s3_secret_key").value.trim(),
        azure_account: $("azure_account").value.trim(),
        azure_container: $("azure_container").value.trim(),
        azure_key: $("azure_key").value.trim(),
        azure_prefix: $("azure_prefix").value.trim(),
        webdav_url: $("webdav_url").value.trim(),
        webdav_user: $("webdav_user").value.trim(),
        webdav_password: $("webdav_password").value.trim(),
        sftp_host: $("sftp_host").value.trim(),
        sftp_user: $("sftp_user").value.trim(),
        sftp_password: $("sftp_password").value.trim(),
        sftp_key_file: $("sftp_key_file").value.trim(),
        sftp_path: $("sftp_path").value.trim(),
        sftp_insecure: !!($("sftp_insecure") && $("sftp_insecure").checked)
      },
      security: { encrypt: !!$("encrypt").checked }
    };
  }

  function fillReview() {
    var b = bodyFromForm();
    $("review").textContent =
      "Name: " + b.name + "\n" +
      "Schedule: " + b.schedule + "\n" +
      "DB: " + b.database.type + "\n" +
      "Dest: " + b.destination.mode + "\n" +
      "Encrypt: " + b.security.encrypt;
  }

  $("btn-save").addEventListener("click", function () {
    if (!probeState.db) { toast("Test database first", false); setStep(2); return; }
    if (!probeState.dest) { toast("Test destination first", false); setStep(3); return; }
    api("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyFromForm())
    }).then(function (j) {
      toast(j.ok ? "Saved" : "Save failed", !!j.ok);
    }).catch(function (e) { toast(String(e), false); });
  });

  $("btn-license").addEventListener("click", function () {
    api("/api/test-license", { method: "POST" }).then(function (j) {
      toast(j.allowed || j.ok ? "License OK" : (j.reason || "Failed"), !!(j.allowed || j.ok));
    });
  });

  $("btn-run").addEventListener("click", function () {
    api("/api/run-once", { method: "POST" }).then(function () {
      toast("Backup started", true);
    });
  });

  function refreshStatus() {
    api("/api/status").then(function (j) {
      $("status").textContent = JSON.stringify(j, null, 2);
      $("status-pill").textContent = j.licenseOk ? "License OK" : "License";
    }).catch(function () {});
  }

  function refreshHistory() {
    api("/api/history").then(function (j) {
      var list = j.history || [];
      $("history").innerHTML = list.map(function (e) {
        return "<div>" + (e.status || "") + " " + (e.started || "") + " " + (e.error || e.message || "") + "</div>";
      }).join("") || "No history";
    }).catch(function () {});
  }

  api("/api/config").then(function (j) {
    var c = j.config || {};
    if (c.name) $("name").value = c.name;
    if (c.schedule) $("schedule").value = c.schedule;
    if (c.database) {
      if (c.database.type) $("db_type").value = c.database.type;
      if (c.database.uri) $("db_uri").value = c.database.uri;
    }
    if (c.destination) {
      if (c.destination.mode) $("dest_mode").value = c.destination.mode;
      if (c.destination.local_dir) $("local_dir").value = c.destination.local_dir;
      if ($("sftp_insecure") && typeof c.destination.sftp_insecure === "boolean") {
        $("sftp_insecure").checked = !!c.destination.sftp_insecure;
      }
    }
    toggleDest();
  }).catch(function () {});

  refreshStatus();
  refreshHistory();
  setInterval(function () {
    refreshStatus();
    refreshHistory();
  }, 5000);
  toggleDest();
})();
