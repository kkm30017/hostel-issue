# Hostel Issue Tracker (Web Dev version)

Open the folder in VS Code and run `index.html` with Live Server (right-click, "Open with Live Server").

## Demo logins (only exist in data.json)

| Role    | Email                | Password     |
|---------|----------------------|--------------|
| Admin   | admin@nmims.in     | Admin@123    |
| Student | ananya@nmims.in   | Student@123  |
| Student | karan@nmims.in    | Student@123  |
| Student | rahul@nmims.in    | Student@123  |

Other students: meera@, sana@, isha@ (same domain and password).

## Signing up as a new admin

Choose "Hostel admin" on the sign-up page and enter the access code.
The code is the `ADMIN_SIGNUP_CODE` line near the top of `api.js`. Change it before your demo.

## Reset

"Reset demo data" (bottom of the admin page) restores data.json and logs everyone out.

## Sign-up and spam rules

- Only college email addresses can sign up. The allowed domains are the
  `ALLOWED_EMAIL_DOMAINS` line near the top of `api.js`. Edit it to match your college.
- Each student: 1 issue per minute, 3 per hour, 8 per day, and at most 5 unresolved at once.
- An open issue for the same hostel, block, room and category cannot be reported again.
- Links, repeated words, repeated letters and random typing are rejected.
- A student can edit their own issue for 15 minutes after reporting it (as long as it is still "open").
  The change is `EDIT_WINDOW_MINUTES` near the top of `api.js`. Edits go through the same spam checks.