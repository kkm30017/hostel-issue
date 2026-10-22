/*
  api.js: the ONLY file that knows where the data lives AND who is allowed to do what.

  Right now:  data.json (first load) + localStorage (all changes)
  Later:      replace the inside of each function with a fetch() call to a backend.
              The pages (main.js) do not change, because every function is async,
              returns the same shape, and fails with the same kind of error
              (an Error with a .status like 401, 403, 404).

  IMPORTANT, be honest about this in your viva:
  Everything here runs in the browser, so anyone can open DevTools and edit
  localStorage. The role checks below are the same checks a backend would do,
  but only a real backend can truly enforce them. Passwords are hashed
  (SHA-256 + a random salt), which is fine for a demo; a real server would use
  a slow hash such as bcrypt.

  The same is true of the spam limits and the college-email rule: they run in
  the browser, so a determined person could bypass them with DevTools. A real
  backend enforces them (and verifies the email by sending a link or code).
*/

const USERS_KEY = "hostel_v4_users";
const ISSUES_KEY = "hostel_v4_issues";
const SESSION_KEY = "hostel_v4_session"; // sessionStorage: holds only the logged-in user's id
const DATA_URL = "data.json";

// Anyone signing up as hostel admin must enter this code. Change it before your demo.
// In a real system this check would happen on the server, never in browser code.
const ADMIN_SIGNUP_CODE = "HOSTEL-ADMIN-2026";

// Only these email domains may sign up (subdomains such as stu.nmims.in are accepted too).
// EDIT THIS LIST to match your college's real email addresses.
const ALLOWED_EMAIL_DOMAINS = ["nmims.in"];

// Anti-spam limits for new issues (per student)
const MIN_SECONDS_BETWEEN_ISSUES = 60;
const MAX_ISSUES_PER_HOUR = 3;
const MAX_ISSUES_PER_DAY = 8;
const MAX_OPEN_ISSUES_PER_STUDENT = 5;

// A student can edit their own issue for this long after reporting it
const EDIT_WINDOW_MINUTES = 15;

const VALID_HOSTELS = ["boys", "girls"];
const VALID_BLOCKS = ["A", "B", "C"];
const VALID_CATEGORIES = ["Water", "Electricity", "WiFi", "Mess", "Cleaning", "Maintenance", "Other"];
const VALID_PRIORITIES = ["low", "normal", "high"];
const VALID_STATUSES = ["open", "in-progress", "resolved"];

/* ---------- private helpers (only used inside this file) ---------- */

// An error with an HTTP-style status code, like a real backend would send
function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Reads a saved list from localStorage. Returns null if it is missing or damaged.
function readStored(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : null;
  } catch (err) {
    return null;
  }
}

// Loads data.json into localStorage the first time (or when the saved copy is
// missing or damaged, so a bad earlier run can never lock you out).
async function ensureSeeded() {
  if (readStored(USERS_KEY) && readStored(ISSUES_KEY)) return;
  let res;
  try {
    res = await fetch(DATA_URL, { cache: "no-store" });
  } catch (err) {
    throw new Error("Could not load data.json. Open the project with VS Code Live Server, not by double-clicking the file.");
  }
  if (!res.ok) throw new Error("Could not load data.json (is it in the same folder as the HTML files?).");
  const data = await res.json();
  if (!Array.isArray(data.users) || !Array.isArray(data.issues)) {
    throw new Error('data.json is an old copy. It must contain both "users" and "issues". Replace it with the newest data.json.');
  }
  localStorage.setItem(USERS_KEY, JSON.stringify(data.users));
  localStorage.setItem(ISSUES_KEY, JSON.stringify(data.issues));
}

async function readList(key) {
  await ensureSeeded();
  return readStored(key);
}

function writeList(key, list) {
  localStorage.setItem(key, JSON.stringify(list));
}

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// Passwords are never stored. We store SHA-256(salt + password).
async function hashPassword(password, salt) {
  if (!window.crypto || !crypto.subtle) {
    throw new Error("Password hashing needs the page to be opened on localhost or https.");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + password));
  return toHex(new Uint8Array(digest));
}

// The version of a user that is safe to give to pages: no password hash, no salt
function toSafeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function currentUser() {
  const id = sessionStorage.getItem(SESSION_KEY);
  if (!id) return null;
  const users = await readList(USERS_KEY);
  const user = users.find((u) => u.id === Number(id));
  return user ? toSafeUser(user) : null;
}

// Guards used by the functions below
async function requireLogin() {
  const user = await currentUser();
  if (!user) throw fail(401, "Please log in first.");
  return user;
}

async function requireRole(role) {
  const user = await requireLogin();
  if (user.role !== role) throw fail(403, "You do not have permission to do that.");
  return user;
}

// Checks a new issue. Returns an error message, or null if fine.
function checkIssueData(d) {
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  if (!VALID_HOSTELS.includes(d.hostel)) return "Choose the boys or girls hostel.";
  if (!VALID_BLOCKS.includes(d.block)) return "Choose a valid block.";
  if (!/^[0-9]{3}$/.test(text(d.room))) return "Room number must be 3 digits.";
  if (!VALID_CATEGORIES.includes(d.category)) return "Choose a valid category.";
  if (!VALID_PRIORITIES.includes(d.priority)) return "Invalid priority.";
  if (text(d.title).length < 5 || text(d.title).length > 80) return "Title must be 5 to 80 characters.";
  if (text(d.description).length < 15 || text(d.description).length > 500) return "Description must be 15 to 500 characters.";
  return checkTextQuality(d.title, d.description);
}

/* ---------- college email check ---------- */

// "stu@nmims.in" and "stu@students.nmims.in" pass. "stu@gmail.com",
// "stu@evilnmims.in" and "stu@nmims.in.evil.com" do not.
function isCollegeEmail(email) {
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const domain = email.slice(at + 1);
  return ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

/* ---------- spam checks for new issues ---------- */

function wordsOf(text) {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// Lower-case letters and digits only, so "No hot water!" equals "no hot water"
function normalizeText(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// True for keyboard mashing such as "asdfgh" or "hjkl sdfg zxcv"
function looksLikeGibberish(text) {
  const lower = text.toLowerCase();
  if (/asdfg|sdfgh|dfghj|fghjk|ghjkl|qwert|werty|ertyu|rtyui|tyuio|yuiop|zxcvb|xcvbn|cvbnm/.test(lower)) return true;

  // Real English (and Hindi written in English letters) has plenty of vowels
  const letters = lower.replace(/[^a-z]/g, "");
  if (letters.length >= 15) {
    const vowelShare = (letters.match(/[aeiou]/g) || []).length / letters.length;
    if (vowelShare < 0.18 || vowelShare > 0.7) return true;
  }

  // Several long "words" with no vowel at all
  const words = lower.split(/\s+/).map((w) => w.replace(/[^a-z]/g, "")).filter((w) => w.length >= 4);
  const noVowel = words.filter((w) => !/[aeiouy]/.test(w));
  return noVowel.length >= 2 && noVowel.length / words.length >= 0.3;
}

// Returns a message if the text looks like spam or nonsense, otherwise null.
function checkTextQuality(title, description) {
  if (wordsOf(title).length < 2) return 'Write a title of at least 2 words, for example "No hot water".';
  if (wordsOf(description).length < 5) return "Describe the problem in at least 5 words: what is wrong, and since when?";

  for (const text of [title, description]) {
    if (/(https?:\/\/|www\.)/i.test(text)) return "Links are not allowed in an issue.";
    if (/([a-z0-9])\1{3,}/i.test(text)) return "Please write normally, without repeating the same letter again and again.";
    if (/([^\s\p{L}\p{N}])\1{5,}/u.test(text)) return "Please write normally, without long rows of the same symbol.";
    const words = wordsOf(text);
    if (words.some((w) => w.length > 25)) return "One of the words is too long to be real. Please write normally.";
    if (words.length >= 6 && new Set(words).size / words.length < 0.5) {
      return "Please do not repeat the same words. Describe the problem once, clearly.";
    }
    if (looksLikeGibberish(text)) return "This looks like random typing. Please describe the real problem in clear words.";
  }
  if (normalizeText(title) === normalizeText(description)) return "The description must say more than the title.";
  return null;
}

// Rate limits and duplicate checks. Throws an error with a friendly message if one is broken.
function checkSpamLimits(user, data, issues) {
  const now = Date.now();
  const ageMs = (i) => now - new Date(i.createdAt).getTime();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const mine = issues.filter((i) => i.reportedById === user.id);

  const newestAge = mine.reduce((min, i) => Math.min(min, ageMs(i)), Infinity);
  const waitSeconds = Math.ceil((MIN_SECONDS_BETWEEN_ISSUES * 1000 - newestAge) / 1000);
  if (waitSeconds > 0) throw fail(429, `Please wait ${waitSeconds} seconds before reporting another issue.`);

  if (mine.filter((i) => ageMs(i) < HOUR).length >= MAX_ISSUES_PER_HOUR) {
    throw fail(429, `You can report at most ${MAX_ISSUES_PER_HOUR} issues per hour. Please try again later.`);
  }
  if (mine.filter((i) => ageMs(i) < DAY).length >= MAX_ISSUES_PER_DAY) {
    throw fail(429, `You can report at most ${MAX_ISSUES_PER_DAY} issues per day. Please try again tomorrow.`);
  }
  if (mine.filter((i) => i.status !== "resolved").length >= MAX_OPEN_ISSUES_PER_STUDENT) {
    throw fail(429, `You already have ${MAX_OPEN_ISSUES_PER_STUDENT} unresolved issues. Please wait until some are resolved.`);
  }

  const title = normalizeText(data.title);
  if (mine.some((i) => ageMs(i) < DAY && normalizeText(i.title) === title)) {
    throw fail(409, "You already reported an issue with this title today.");
  }

  const room = data.room.trim();
  const sameSpot = issues.find(
    (i) => i.hostel === data.hostel && i.block === data.block && i.room === room &&
           i.category === data.category && i.status !== "resolved"
  );
  if (sameSpot) {
    throw fail(409, `An open ${data.category} issue for this room has already been reported and is being handled. Please do not report it again.`);
  }
}

/* ---------- editing your own issue ---------- */

// Adds two fields for the page: canEdit (true/false) and editableUntil (a time).
// A student may edit their OWN issue for 15 minutes, and only while it is still "open".
function withEditInfo(issue, user) {
  const until = new Date(issue.createdAt).getTime() + EDIT_WINDOW_MINUTES * 60 * 1000;
  const canEdit =
    user.role === "student" &&
    issue.reportedById === user.id &&
    issue.status === "open" &&
    Date.now() < until;
  return { ...issue, canEdit, editableUntil: new Date(until).toISOString() };
}

/* ---------- public functions (these are what main.js calls) ---------- */

const api = {
  /* ----- accounts and sessions ----- */

  // Creates an account, then logs it in. role is "student" or "admin".
  async signup({ role, name, email, password, adminCode }) {
    if (role !== "student" && role !== "admin") throw fail(400, "Choose student or hostel admin.");
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 60) {
      throw fail(400, "Name must be 2 to 60 characters.");
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw fail(400, "Enter a valid email address.");
    if (!isCollegeEmail(cleanEmail)) {
      throw fail(400, `Only college email addresses can sign up. Use your address ending in ${ALLOWED_EMAIL_DOMAINS.map((d) => "@" + d).join(" or ")}.`);
    }
    if (typeof password !== "string" || password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      throw fail(400, "Password must be at least 8 characters with a letter and a number.");
    }
    if (role === "admin" && adminCode !== ADMIN_SIGNUP_CODE) {
      throw fail(403, "Wrong admin access code. Ask the hostel office for the code.");
    }

    const users = await readList(USERS_KEY);
    if (users.some((u) => u.email === cleanEmail)) {
      throw fail(409, "An account with this email already exists.");
    }

    const salt = randomSalt();
    const user = {
      id: users.reduce((max, u) => Math.max(max, u.id), 0) + 1,
      name: name.trim(),
      email: cleanEmail,
      role,
      salt,
      passwordHash: await hashPassword(password, salt),
    };
    users.push(user);
    writeList(USERS_KEY, users);
    sessionStorage.setItem(SESSION_KEY, String(user.id));
    return toSafeUser(user);
  },

  // Checks the password and starts a session. The error is the same for a wrong
  // email and a wrong password, so nobody can find out which emails have accounts.
  async login(email, password) {
    const users = await readList(USERS_KEY);
    const user = users.find((u) => u.email === String(email).trim().toLowerCase());
    const wrong = fail(401, "Incorrect email or password.");
    if (!user) throw wrong;
    if ((await hashPassword(String(password), user.salt)) !== user.passwordHash) throw wrong;
    sessionStorage.setItem(SESSION_KEY, String(user.id));
    return toSafeUser(user);
  },

  async logout() {
    sessionStorage.removeItem(SESSION_KEY);
    return true;
  },

  // Returns the logged-in user, or null if nobody is logged in
  async getCurrentUser() {
    return currentUser();
  },

  /* ----- issues ----- */

  // Students get ONLY their own issues. Admins get all issues.
  // Optional filters: status, category, hostel, search. Newest first.
  async getIssues({ status = "", category = "", hostel = "", search = "" } = {}) {
    const user = await requireLogin();
    let issues = await readList(ISSUES_KEY);
    if (user.role === "student") issues = issues.filter((i) => i.reportedById === user.id);
    if (status) issues = issues.filter((i) => i.status === status);
    if (category) issues = issues.filter((i) => i.category === category);
    if (hostel) issues = issues.filter((i) => i.hostel === hostel);
    const q = search.trim().toLowerCase();
    if (q) {
      issues = issues.filter((i) =>
        (i.title + " " + i.description + " " + i.room + " " + i.reportedBy).toLowerCase().includes(q)
      );
    }
    return issues.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  // Returns one issue, or null if it does not exist OR the student does not own it
  async getIssue(id) {
    const user = await requireLogin();
    const issues = await readList(ISSUES_KEY);
    const issue = issues.find((i) => i.id === Number(id));
    if (!issue) return null;
    if (user.role === "student" && issue.reportedById !== user.id) return null;
    return withEditInfo(issue, user);
  },

  // Students only. The reporter is taken from the logged-in account, not from the form.
  async addIssue(data) {
    const user = await requireRole("student");
    const problem = checkIssueData(data);
    if (problem) throw fail(400, problem);

    const issues = await readList(ISSUES_KEY);
    checkSpamLimits(user, data, issues);
    const issue = {
      id: issues.reduce((max, i) => Math.max(max, i.id), 0) + 1,
      title: data.title.trim(),
      category: data.category,
      hostel: data.hostel,
      block: data.block,
      room: data.room.trim(),
      priority: data.priority,
      description: data.description.trim(),
      reportedBy: user.name,
      reportedById: user.id,
      status: "open",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    issues.push(issue);
    writeList(ISSUES_KEY, issues);
    return issue;
  },

  // Students only: change their own issue within 15 minutes of reporting it.
  // The same text and duplicate checks as a new issue apply, so editing cannot be used to sneak spam in.
  async updateIssue(id, data) {
    const user = await requireRole("student");
    const issues = await readList(ISSUES_KEY);
    const issue = issues.find((i) => i.id === Number(id) && i.reportedById === user.id);
    if (!issue) throw fail(404, "Issue not found.");
    if (!withEditInfo(issue, user).canEdit) {
      throw fail(
        403,
        issue.status !== "open"
          ? "The hostel administration has already started on this issue, so it can no longer be edited."
          : `An issue can only be edited for ${EDIT_WINDOW_MINUTES} minutes after it is reported. That time is over.`
      );
    }

    const problem = checkIssueData(data);
    if (problem) throw fail(400, problem);

    const DAY = 24 * 60 * 60 * 1000;
    const title = normalizeText(data.title);
    const others = issues.filter((i) => i.id !== issue.id);
    if (others.some((i) => i.reportedById === user.id && Date.now() - new Date(i.createdAt).getTime() < DAY && normalizeText(i.title) === title)) {
      throw fail(409, "You already reported another issue with this title today.");
    }
    const room = data.room.trim();
    if (others.some((i) => i.hostel === data.hostel && i.block === data.block && i.room === room &&
                           i.category === data.category && i.status !== "resolved")) {
      throw fail(409, `An open ${data.category} issue for this room has already been reported and is being handled.`);
    }

    Object.assign(issue, {
      title: data.title.trim(),
      category: data.category,
      hostel: data.hostel,
      block: data.block,
      room,
      priority: data.priority,
      description: data.description.trim(),
      editedAt: new Date().toISOString(),
    });
    writeList(ISSUES_KEY, issues);
    return withEditInfo(issue, user);
  },

  // Admins only
  async updateStatus(id, status) {
    await requireRole("admin");
    if (!VALID_STATUSES.includes(status)) throw fail(400, "Invalid status.");
    const issues = await readList(ISSUES_KEY);
    const issue = issues.find((i) => i.id === Number(id));
    if (!issue) throw fail(404, "Issue not found.");
    issue.status = status;
    issue.resolvedAt = status === "resolved" ? new Date().toISOString() : null;
    writeList(ISSUES_KEY, issues);
    return issue;
  },

  // Admins only
  async deleteIssue(id) {
    await requireRole("admin");
    const issues = await readList(ISSUES_KEY);
    if (!issues.some((i) => i.id === Number(id))) throw fail(404, "Issue not found.");
    writeList(ISSUES_KEY, issues.filter((i) => i.id !== Number(id)));
    return true;
  },

  // Counts per status, for the numbers at the top of the dashboards.
  // A student's counts include only their own issues.
  async getStats() {
    const user = await requireLogin();
    let issues = await readList(ISSUES_KEY);
    if (user.role === "student") issues = issues.filter((i) => i.reportedById === user.id);
    return {
      open: issues.filter((i) => i.status === "open").length,
      inProgress: issues.filter((i) => i.status === "in-progress").length,
      resolved: issues.filter((i) => i.status === "resolved").length,
    };
  },

  // Demo helper: throws away all changes and reloads data.json
  async resetData() {
    localStorage.removeItem(USERS_KEY);
    localStorage.removeItem(ISSUES_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    await ensureSeeded();
    return true;
  },
};