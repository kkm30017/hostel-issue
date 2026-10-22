/*
  main.js: page logic for all pages. It never touches localStorage or data.json.
  It only calls the functions in api.js (api.login, api.getIssues, ...).
  Each HTML page has <body data-page="..."> so we know which init function to run.

  Two kinds of pages:
    public pages  (home, login, signup): anyone can open them
    guarded pages (student, admin, report, issue): guard() sends you away
                  if you are not logged in or have the wrong role
*/

const CATEGORIES = ["Water", "Electricity", "WiFi", "Mess", "Cleaning", "Maintenance", "Other"];
const STATUS_LABELS = {
  open: "Open",
  "in-progress": "In progress",
  resolved: "Resolved",
};
const PRIORITY_LABELS = { low: "Low", normal: "Normal", high: "High" };
const HOSTEL_LABELS = { boys: "Boys hostel", girls: "Girls hostel" };

/* ---------- small helpers ---------- */

// Makes user text safe before putting it into innerHTML
function esc(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3500);
}

// A message that should appear on the NEXT page (after a redirect)
function queueToast(message) {
  sessionStorage.setItem("pending_toast", message);
}

function showPendingToast() {
  const message = sessionStorage.getItem("pending_toast");
  if (message) {
    sessionStorage.removeItem("pending_toast");
    showToast(message);
  }
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Shows the time left until `untilIso` inside `el` as m:ss, and calls onDone() when it reaches zero.
// Returns the timer id, so the caller can stop it with clearInterval.
function startCountdown(el, untilIso, onDone) {
  const until = new Date(untilIso).getTime();
  function tick() {
    const left = until - Date.now();
    if (left <= 0) {
      clearInterval(timer);
      onDone();
      return;
    }
    const total = Math.ceil(left / 1000);
    el.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }
  const timer = setInterval(tick, 1000);
  tick();
  return timer;
}

function fillSelect(select, options, firstLabel) {
  select.innerHTML =
    `<option value="">${firstLabel}</option>` +
    options.map((o) => `<option value="${o}">${o}</option>`).join("");
}

// If something goes badly wrong (for example data.json cannot be loaded)
function showFatal(err) {
  const main = document.querySelector("main");
  main.hidden = false;
  main.innerHTML = `<p class="note error">${esc(err.message)}</p>`;
}

/* ---------- who is logged in, navigation, access guards ---------- */

function homeFor(user) {
  return user.role === "admin" ? "admin.html" : "student.html";
}

// Draws the menu in the header. Each role sees a different menu.
function renderNav(user) {
  const nav = document.getElementById("main-nav");
  const page = document.body.dataset.page;
  const link = (href, label, key) =>
    `<a href="${href}"${page === key ? ' aria-current="page"' : ""}>${label}</a>`;
  const logout = `<button type="button" class="link-btn" id="logout-btn">Log out</button>`;

  if (!user) {
    nav.innerHTML = link("login.html", "Log in", "login") + link("signup.html", "Sign up", "signup");
  } else if (user.role === "admin") {
    document.body.classList.add("role-admin");
    nav.innerHTML =
      link("admin.html", "All issues", "admin") +
      `<span class="nav-user">${esc(user.name)}</span>` + logout;
  } else {
    nav.innerHTML =
      link("student.html", "My issues", "student") +
      link("report.html", "Report an issue", "report") +
      `<span class="nav-user">${esc(user.name)}</span>` + logout;
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await api.logout();
      queueToast("You have been logged out");
      window.location.href = "login.html";
    });
  }
}

// Use at the start of every guarded page.
// role = "student" or "admin" (only that role may enter), or null (any logged-in user).
// Returns the user if allowed, or null after redirecting away.
async function guard(role) {
  const user = await api.getCurrentUser();
  if (!user) {
    queueToast("Please log in first");
    window.location.href = "login.html";
    return null;
  }
  if (role && user.role !== role) {
    queueToast(`That page is only for ${role === "admin" ? "hostel administration" : "students"}.`);
    window.location.href = homeFor(user);
    return null;
  }
  renderNav(user);
  document.getElementById("page").hidden = false; // the page stays hidden until the guard says yes
  return user;
}

// Use on public pages: a logged-in person goes straight to their own dashboard
async function redirectIfLoggedIn() {
  const user = await api.getCurrentUser();
  if (user) {
    window.location.href = homeFor(user);
    return true;
  }
  renderNav(null);
  return false;
}

/* ---------- form validation (shared by login, signup and report) ---------- */

// rules: { fieldName: (value, form) => true or "error message" }
// Each field needs an element with id="err-<fieldName>" to show its message.
function setupValidation(form, rules) {
  const firstField = (name) => form.querySelector(`[name="${name}"]`);

  function checkField(name) {
    const result = rules[name](form.elements[name].value, form);
    const errorBox = document.getElementById(`err-${name}`);
    const field = firstField(name);
    const canMark = field.type !== "radio";
    if (result === true) {
      errorBox.textContent = "";
      if (canMark) field.removeAttribute("aria-invalid");
      return true;
    }
    errorBox.textContent = result;
    if (canMark) field.setAttribute("aria-invalid", "true");
    return false;
  }

  // Re-check a field when the user leaves it (radio buttons: when they change)
  Object.keys(rules).forEach((name) => {
    form.querySelectorAll(`[name="${name}"]`).forEach((field) => {
      field.addEventListener(field.type === "radio" ? "change" : "blur", () => checkField(name));
    });
  });

  // Checks every field. Returns true only if all are fine; otherwise focuses the first bad one.
  return function checkAll() {
    const failed = Object.keys(rules).filter((name) => !checkField(name));
    if (failed.length > 0) {
      firstField(failed[0]).focus();
      return false;
    }
    return true;
  };
}

/* ---------- home page ---------- */

async function initHome() {
  await redirectIfLoggedIn();
}

/* ---------- login page ---------- */

async function initLogin() {
  if (await redirectIfLoggedIn()) return;
  const form = document.getElementById("login-form");
  const checkAll = setupValidation(form, {
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || "Enter a valid email address.",
    password: (v) => v !== "" || "Enter your password.",
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!checkAll()) return;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const user = await api.login(form.elements.email.value, form.elements.password.value);
      queueToast(`Welcome, ${user.name}`);
      window.location.href = homeFor(user);
    } catch (err) {
      document.getElementById("form-error").textContent = err.message;
      button.disabled = false;
    }
  });
}

/* ---------- sign up page ---------- */

async function initSignup() {
  if (await redirectIfLoggedIn()) return;
  const form = document.getElementById("signup-form");
  const adminField = document.getElementById("admin-code-field");

  // Choose the role from the link (signup.html?role=admin) or from the radio buttons
  const wanted = new URLSearchParams(window.location.search).get("role");
  if (wanted === "admin") form.querySelector('input[name="role"][value="admin"]').checked = true;

  function showOrHideAdminCode() {
    adminField.hidden = form.elements.role.value !== "admin";
  }
  form.querySelectorAll('input[name="role"]').forEach((r) =>
    r.addEventListener("change", showOrHideAdminCode)
  );
  showOrHideAdminCode();

  const checkAll = setupValidation(form, {
    name: (v) => (v.trim().length >= 2 && v.trim().length <= 60) || "Enter your name (2 to 60 characters).",
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || "Enter a valid email address.",
    password: (v) =>
      (v.length >= 8 && /[A-Za-z]/.test(v) && /[0-9]/.test(v)) ||
      "Use at least 8 characters, with a letter and a number.",
    confirm: (v, f) => v === f.elements.password.value || "The passwords do not match.",
    adminCode: (v, f) =>
      f.elements.role.value !== "admin" || v.trim() !== "" || "Enter the admin access code.",
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!checkAll()) return;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const user = await api.signup({
        role: form.elements.role.value,
        name: form.elements.name.value,
        email: form.elements.email.value,
        password: form.elements.password.value,
        adminCode: form.elements.adminCode.value.trim(),
      });
      queueToast("Account created");
      window.location.href = homeFor(user);
    } catch (err) {
      document.getElementById("form-error").textContent = err.message;
      button.disabled = false;
    }
  });
}

/* ---------- dashboards: the student page and the admin page ---------- */

function issueRow(issue, showReporter) {
  return `
    <a class="issue ${issue.status}" href="issue.html?id=${issue.id}">
      <div class="issue-main">
        <h3>${esc(issue.title)}</h3>
        <p>${esc(issue.category)} &ndash; ${HOSTEL_LABELS[issue.hostel] || ""}, block ${esc(issue.block)}, room ${esc(issue.room)}${
          showReporter ? ` &ndash; reported by ${esc(issue.reportedBy)}` : ""
        }</p>
      </div>
      <div class="issue-side">
        <span class="badge ${issue.status}">${STATUS_LABELS[issue.status]}</span>
        <span class="date">${formatDate(issue.createdAt)}</span>
      </div>
    </a>`;
}

// The same code draws both dashboards. The role decides who may enter and
// what api.getIssues returns (a student only ever receives their own issues).
async function initDashboard(role) {
  const user = await guard(role);
  if (!user) return;

  const list = document.getElementById("issue-list");
  const search = document.getElementById("search");
  const category = document.getElementById("filter-category");
  const status = document.getElementById("filter-status");
  const hostel = document.getElementById("filter-hostel"); // only on the admin page
  fillSelect(category, CATEGORIES, "All categories");

  async function render() {
    try {
      const [issues, stats] = await Promise.all([
        api.getIssues({
          search: search.value,
          category: category.value,
          status: status.value,
          hostel: hostel ? hostel.value : "",
        }),
        api.getStats(),
      ]);

      document.getElementById("stat-open").textContent = stats.open;
      document.getElementById("stat-progress").textContent = stats.inProgress;
      document.getElementById("stat-resolved").textContent = stats.resolved;

      if (issues.length === 0) {
        const filtering = search.value.trim() || category.value || status.value || (hostel && hostel.value);
        if (filtering) {
          list.innerHTML = `<p class="note">No issues match these filters. Clear the search or filters to see everything.</p>`;
        } else if (role === "student") {
          list.innerHTML = `<p class="note">You have not reported any issues yet. <a href="report.html">Report your first issue</a>.</p>`;
        } else {
          list.innerHTML = `<p class="note">No issues have been reported yet.</p>`;
        }
        return;
      }
      list.innerHTML = issues.map((i) => issueRow(i, role === "admin")).join("");
    } catch (err) {
      list.innerHTML = `<p class="note error">${esc(err.message)}</p>`;
    }
  }

  search.addEventListener("input", render);
  category.addEventListener("change", render);
  status.addEventListener("change", render);
  if (hostel) hostel.addEventListener("change", render);

  const welcome = document.getElementById("welcome");
  if (welcome) welcome.textContent = `Signed in as ${user.name}`;

  const resetLink = document.getElementById("reset-data");
  if (resetLink) {
    // Click once to ask, click again within 4 seconds to confirm
    let armed = false;
    resetLink.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        resetLink.textContent = "Click again to confirm reset";
        setTimeout(() => {
          armed = false;
          resetLink.textContent = "Reset demo data";
        }, 4000);
        return;
      }
      await api.resetData();
      queueToast("Demo data restored. Please log in again.");
      window.location.href = "login.html";
    });
  }

  render();
}

/* ---------- report page (students only) ---------- */

async function initReport() {
  const user = await guard("student");
  if (!user) return;

  const form = document.getElementById("report-form");
  const category = document.getElementById("category");
  const description = document.getElementById("description");
  const counter = document.getElementById("char-count");
  fillSelect(category, CATEGORIES, "Choose a category");
  document.getElementById("reporting-as").textContent = `Reporting as ${user.name}`;

  description.addEventListener("input", () => {
    counter.textContent = `${description.value.length} / 500`;
  });

  // Edit mode: report.html?edit=12 changes an existing issue instead of creating a new one
  const editId = new URLSearchParams(window.location.search).get("edit");
  if (editId) {
    document.getElementById("page-title").textContent = "Edit your issue";
    let existing = null;
    try {
      existing = await api.getIssue(editId);
    } catch (err) {
      existing = null;
    }
    if (!existing || !existing.canEdit) {
      form.hidden = true;
      form.insertAdjacentHTML(
        "beforebegin",
        `<p class="note error">This issue can no longer be edited. Issues can be edited for 15 minutes after they are
         reported, as long as the hostel administration has not started on them.
         <a href="student.html">Back to my issues</a></p>`
      );
      return;
    }

    document.getElementById("submit-btn").textContent = "Save changes";
    form.querySelector(`input[name="hostel"][value="${existing.hostel}"]`).checked = true;
    form.elements.block.value = existing.block;
    form.elements.room.value = existing.room;
    form.elements.category.value = existing.category;
    form.querySelector(`input[name="priority"][value="${existing.priority}"]`).checked = true;
    form.elements.title.value = existing.title;
    description.value = existing.description;
    counter.textContent = `${existing.description.length} / 500`;

    const note = document.getElementById("edit-note");
    note.hidden = false;
    note.innerHTML = 'You can save changes for <b id="edit-form-timer"></b> more.';
    startCountdown(document.getElementById("edit-form-timer"), existing.editableUntil, () => {
      note.textContent = "The 15 minutes are over, so this issue can no longer be edited.";
      document.getElementById("submit-btn").disabled = true;
    });
  }

  const checkAll = setupValidation(form, {
    hostel: (v) => v !== "" || "Choose the boys hostel or the girls hostel.",
    block: (v) => v !== "" || "Choose your block.",
    room: (v) => /^[0-9]{3}$/.test(v.trim()) || "Enter a 3-digit room number, like 214.",
    category: (v) => v !== "" || "Choose a category.",
    title: (v) => {
      if (v.trim().length < 5 || v.trim().length > 80) return "Title must be 5 to 80 characters.";
      return wordCount(v) >= 2 || 'Write a title of at least 2 words, like "No hot water".';
    },
    description: (v) => {
      if (v.trim().length < 15) return "Describe the problem in at least 15 characters.";
      return wordCount(v) >= 5 || "Describe the problem in at least 5 words: what is wrong, and since when?";
    },
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!checkAll()) return;

    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const fields = {
        hostel: form.elements.hostel.value,
        block: form.elements.block.value,
        room: form.elements.room.value.trim(),
        category: form.elements.category.value,
        priority: form.elements.priority.value,
        title: form.elements.title.value.trim(),
        description: form.elements.description.value.trim(),
      };
      const issue = editId ? await api.updateIssue(editId, fields) : await api.addIssue(fields);
      queueToast(editId ? "Changes saved" : "Issue reported");
      window.location.href = `issue.html?id=${issue.id}`;
    } catch (err) {
      document.getElementById("form-error").textContent = err.message;
      button.disabled = false;
    }
  });
}

/* ---------- detail page: admins can change status or delete, students only read ---------- */

async function initIssue() {
  const user = await guard(null); // any logged-in user may open this page
  if (!user) return;

  const backLink = document.getElementById("back-link");
  backLink.href = homeFor(user);
  const box = document.getElementById("issue-detail");
  const id = new URLSearchParams(window.location.search).get("id");
  const isAdmin = user.role === "admin";

  let editTimer = null;

  async function render() {
    clearInterval(editTimer);
    try {
      // For a student, api.getIssue returns null unless the issue is theirs
      const issue = await api.getIssue(id);
      if (!issue) {
        box.innerHTML = `<p class="note error">This issue does not exist, or you do not have access to it. <a href="${homeFor(user)}">Go back</a></p>`;
        return;
      }

      const statusSection = isAdmin
        ? `<h2>Status</h2>
           <div class="status-group" role="group" aria-label="Change status">
             ${Object.keys(STATUS_LABELS)
               .map(
                 (s) => `<button type="button" class="btn status-btn ${s}"
                           data-status="${s}" aria-pressed="${issue.status === s}">
                           ${STATUS_LABELS[s]}</button>`
               )
               .join("")}
           </div>
           <div class="danger-zone" id="danger-zone">
             <button type="button" class="btn btn-danger" id="delete-btn">Delete issue</button>
           </div>`
        : `<h2>Status</h2>
           <p><span class="badge ${issue.status}">${STATUS_LABELS[issue.status]}</span></p>
           <p class="meta">Only the hostel administration can change the status.</p>
           ${
             issue.canEdit
               ? `<div class="edit-box">
                    <a class="btn" id="edit-btn" href="report.html?edit=${issue.id}">Edit issue</a>
                    <span class="meta">You can edit this issue for <b id="edit-timer"></b> more.</span>
                  </div>`
               : ""
           }`;

      box.innerHTML = `
        <div class="detail ${issue.status}">
          <h1>${esc(issue.title)}</h1>
          <p class="meta">
            ${esc(issue.category)} &ndash; ${HOSTEL_LABELS[issue.hostel] || ""}, block ${esc(issue.block)}, room ${esc(issue.room)}
            &ndash; ${PRIORITY_LABELS[issue.priority]} priority
          </p>
          <p class="description">${esc(issue.description)}</p>
          <p class="meta">
            Reported by ${esc(issue.reportedBy)} on ${formatDate(issue.createdAt)}.
            ${issue.resolvedAt ? `Resolved on ${formatDate(issue.resolvedAt)}.` : ""}
            ${issue.editedAt ? `Edited on ${formatDate(issue.editedAt)}.` : ""}
          </p>
          ${statusSection}
        </div>`;

      // When the 15 minutes run out, draw the page again so the Edit button disappears
      if (issue.canEdit) {
        editTimer = startCountdown(document.getElementById("edit-timer"), issue.editableUntil, render);
      }

      if (!isAdmin) return;

      box.querySelectorAll(".status-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await api.updateStatus(id, btn.dataset.status);
            await render();
            showToast(`Marked as ${STATUS_LABELS[btn.dataset.status].toLowerCase()}`);
          } catch (err) {
            showToast(err.message);
          }
        });
      });

      // Step 1: clicking "Delete issue" asks for confirmation on the page itself
      document.getElementById("delete-btn").addEventListener("click", () => {
        const zone = document.getElementById("danger-zone");
        zone.innerHTML = `
          <p class="meta">Delete this issue? This cannot be undone.</p>
          <button type="button" class="btn btn-danger" id="confirm-delete">Yes, delete</button>
          <button type="button" class="btn" id="cancel-delete">Cancel</button>`;
        document.getElementById("confirm-delete").focus();

        // Step 2a: confirmed, so delete and go back to the list
        document.getElementById("confirm-delete").addEventListener("click", async () => {
          try {
            await api.deleteIssue(id);
            queueToast("Issue deleted");
            window.location.href = homeFor(user);
          } catch (err) {
            zone.innerHTML = `<p class="note error">${esc(err.message)}</p>`;
          }
        });

        // Step 2b: cancelled, so draw the page again
        document.getElementById("cancel-delete").addEventListener("click", render);
      });
    } catch (err) {
      box.innerHTML = `<p class="note error">${esc(err.message)}</p>`;
    }
  }

  render();
}

/* ---------- start the right code for the current page ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  showPendingToast();
  const page = document.body.dataset.page;
  try {
    if (page === "home") await initHome();
    if (page === "login") await initLogin();
    if (page === "signup") await initSignup();
    if (page === "student") await initDashboard("student");
    if (page === "admin") await initDashboard("admin");
    if (page === "report") await initReport();
    if (page === "issue") await initIssue();
  } catch (err) {
    showFatal(err);
  }
});