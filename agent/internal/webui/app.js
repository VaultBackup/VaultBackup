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
  var termsVersion = "";

  function toast(msg, ok) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast " + (ok ? "ok" : "bad");
    setTimeout(function () { t.className = "toast hidden"; }, 2800);
  }

  function setStep(n) {
    document.querySelectorAll(".step").forEach(function (b) {
      var s = Number(b.getAttribute("data-step"));
      b.classList.toggle("on", s === n);
      b.classList.toggle("done", s < n);
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

  $("next-1").addEventListener("click", function () {
    if (!$("terms_accept").checked) {
      toast("Please accept the EULA to continue", false);
      return;
    }
    setStep(2);
  });
  $("next-2").addEventListener("click", function () {
    if (!probeState.db) {
      toast("Test the database connection first", false);
      setProbe("bad", "Run Test connection and wait for a green result.");
      return;
    }
    setStep(3);
  });
  $("next-3").addEventListener("click", function () {
    if (!probeState.dest) {
      toast("Test the destination connection first", false);
      setDestProbe("bad", "Run Test connection and wait for a green result.");
      return;
    }
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
    setDestProbe("", "Test the destination so we know backups can be written there.");
  });

  function refreshReviewProbeMsg() {
    var el = $("review-probe-msg");
    var box = $("review-probes");
    if (!el || !box) return;
    box.classList.remove("ok", "bad", "busy");
    if (probeState.db && probeState.dest) {
      box.classList.add("ok");
      el.textContent = "Both checks passed — you’re ready to save.";
    } else {
      box.classList.add("bad");
      var missing = [];
      if (!probeState.db) missing.push("database");
      if (!probeState.dest) missing.push("destination");
      el.textContent = "Still needed: successful " + missing.join(" and ") + " test.";
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
      setProbe("bad", "Please enter a connection URI first.");
      toast("Connection URI is required", false);
      return;
    }
    if (btn) btn.disabled = true;
    setProbe("busy", "Checking database…");
    api("/api/test-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type, uri: uri })
    }).then(function (j) {
      if (j.ok) {
        var extra = j.detail ? " · " + j.detail : "";
        setProbe("ok", "Looks good (" + (j.latencyMs || 0) + " ms)" + extra);
        toast("Database is reachable", true);
        $("kpi-db").textContent = "Reachable";
      } else {
        setProbe("bad", j.detail || j.status || "Could not connect");
        toast(j.detail || "Database test failed", false);
        $("kpi-db").textContent = "Unreachable";
      }
    }).catch(function (e) {
      setProbe("bad", String(e.message || e));
      toast(String(e.message || e), false);
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
      sftp_path: $("sftp_path").value.trim()
    };
    if (btn) btn.disabled = true;
    setDestProbe("busy", "Checking destination…");
    api("/api/test-dest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (j) {
      if (j.ok) {
        setDestProbe("ok", "Looks good (" + (j.latencyMs || 0) + " ms)" + (j.detail ? " · " + j.detail : ""));
        toast("Destination is ready", true);
      } else {
        setDestProbe("bad", j.detail || j.status || "Destination check failed");
        toast(j.detail || "Destination test failed", false);
      }
    }).catch(function (e) {
      setDestProbe("bad", String(e.message || e));
      toast(String(e.message || e), false);
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  $("btn-test-db").addEventListener("click", function () { runDbTest($("btn-test-db")); });
  $("btn-test-dest").addEventListener("click", function () { runDestTest($("btn-test-dest")); });
  $("btn-review-test-db").addEventListener("click", function () { runDbTest($("btn-review-test-db")); });
  $("btn-review-test-dest").addEventListener("click", function () { runDestTest($("btn-review-test-dest")); });

  $("db_type").addEventListener("change", function () {
    probeState.db = false;
    setProbe("", "Test the connection so we know this machine can reach the database.");
  });
  $("db_uri").addEventListener("input", function () {
    probeState.db = false;
    setProbe("", "Test the connection so we know this machine can reach the database.");
  });

  function bodyFromForm() {
    return {
      terms_accepted: !!$("terms_accept").checked,
      terms_version: termsVersion,
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
        sftp_path: $("sftp_path").value.trim()
      },
      security: { encrypt: !!$("encrypt").checked }
    };
  }

  function fillReview() {
    var b = bodyFromForm();
    $("review").textContent =
      "Name: " + (b.name || "(unnamed)") + "\n" +
      "Schedule: " + b.schedule + "\n" +
      "License server: https://backup.enadoctemp.workers.dev (fixed)\n" +
      "DB: " + b.database.type + (b.database.uri ? " / URI set" : " / URI missing") + "\n" +
      "Dest: " + b.destination.mode + "\n" +
      "Encrypt: " + b.security.encrypt + "\n" +
      "EULA accepted: " + b.terms_accepted;
  }

  $("btn-save").addEventListener("click", function () {
    if (!$("terms_accept").checked) {
      toast("Accept the EULA on step 1 before saving", false);
      setStep(1);
      return;
    }
    if (!probeState.db) {
      toast("Test the database connection first", false);
      setStep(2);
      return;
    }
    if (!probeState.dest) {
      toast("Test the destination connection first", false);
      setStep(3);
      return;
    }
    api("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyFromForm())
    }).then(function (j) {
      toast(j.ok ? "Configuration saved" : "Save failed", !!j.ok);
      $("token").value = "";
      return refreshStatus();
    }).catch(function (e) {
      toast(String(e.message || e), false);
    });
  });

  $("btn-license").addEventListener("click", function () {
    api("/api/test-license", { method: "POST" }).then(function (j) {
      toast(j.allowed || j.ok ? "License looks good" : (j.reason || "License check failed"), !!(j.allowed || j.ok));
      return refreshStatus();
    }).catch(function (e) { toast(String(e.message || e), false); });
  });

  $("btn-run").addEventListener("click", function () {
    api("/api/run-once", { method: "POST" }).then(function () {
      toast("Backup started", true);
      setTimeout(refreshHistory, 1500);
    }).catch(function (e) { toast(String(e.message || e), false); });
  });

  function refreshStatus() {
    return api("/api/status").then(function (j) {
      $("status").textContent = JSON.stringify(j, null, 2);
      var pill = $("status-pill");
      if (j.licenseOk) {
        pill.textContent = "License OK";
        pill.className = "badge ok";
        $("kpi-lic").textContent = "Active";
      } else {
        pill.textContent = "License";
        pill.className = "badge";
        $("kpi-lic").textContent = j.licenseReason || "Check needed";
      }
      if (j.database && j.database.ok) $("kpi-db").textContent = "Reachable";
      else if (j.database) $("kpi-db").textContent = j.database.status || "—";
    }).catch(function () {});
  }

  function refreshHistory() {
    return api("/api/history").then(function (j) {
      var list = j.history || [];
      if (!list.length) {
        $("history").innerHTML = '<div class="hist-empty">No backup attempts yet. Run one when you’re ready.</div>';
        return;
      }
      $("history").innerHTML = list.map(function (e) {
        return '<div class="hist-item"><strong>' + (e.status || "") + '</strong> · ' +
          (e.started || "") + (e.error ? " · " + e.error : (e.message ? " · " + e.message : "")) + "</div>";
      }).join("");
    }).catch(function () {});
  }

  function loadTerms() {
    return api("/api/terms").then(function (j) {
      termsVersion = j.version || "";
      $("terms-text").textContent = j.text || "EULA unavailable.";
    }).catch(function () {
      $("terms-text").textContent = "Could not load EULA. Please restart the agent and try again.";
    });
  }

  api("/api/config").then(function (j) {
    var c = j.config || {};
    if (c.name) $("name").value = c.name;
    if (c.schedule) {
      $("schedule").value = c.schedule;
      $("kpi-sch").textContent = c.schedule;
    }
    if (c.retention) $("retention").value = c.retention;
    if (c.database) {
      if (c.database.type) $("db_type").value = c.database.type;
      if (c.database.uri) $("db_uri").value = c.database.uri;
      if (c.database.backup_type) $("backup_type").value = c.database.backup_type;
    }
    if (c.destination) {
      if (c.destination.mode) $("dest_mode").value = c.destination.mode;
      if (c.destination.local_dir) $("local_dir").value = c.destination.local_dir;
      if (c.destination.s3_endpoint) $("s3_endpoint").value = c.destination.s3_endpoint;
      if (c.destination.s3_region) $("s3_region").value = c.destination.s3_region;
      if (c.destination.s3_bucket) $("s3_bucket").value = c.destination.s3_bucket;
      if (c.destination.s3_prefix) $("s3_prefix").value = c.destination.s3_prefix;
      if (c.destination.s3_access_key) $("s3_access_key").value = c.destination.s3_access_key;
    }
    if (c.security && typeof c.security.encrypt === "boolean") $("encrypt").checked = c.security.encrypt;
    if (c.terms_accepted) $("terms_accept").checked = true;
    toggleDest();
  }).catch(function () {});

  loadTerms();
  refreshStatus();
  refreshHistory();
  setInterval(function () {
    refreshStatus();
    refreshHistory();
  }, 4000);
})();
