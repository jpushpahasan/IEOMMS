# Phase 4 — Documents, Financial Tracking, Notifications, Approvals, Final Clearance & Deployment

## 1. Database changes

| Table / change | Purpose |
|---|---|
| `employee_documents` category list | Adds **invoice** (supporting invoices for expenses). The repository already versions documents and records expiry dates. |
| `mobilisation_expenses` | One cost line per employee: category (the 11 categories of Module 7), description, **estimated** and **actual** cost, supplier / service provider, invoice number + date, **payment status** (unpaid / partially paid / paid) and payment date, supporting invoice document, **finance verification** (pending / verified / rejected, by whom, when, remarks), and the source record when it was created automatically (e.g. a flight booking). Rules in the database: amounts ≥ 0; *paid ⇒ payment date*; *verified ⇒ verifier and time*. |
| `notifications` | In-app notifications per recipient: type, severity, title, message, link, candidate, `dedupe_key` (so a condition notifies once per stage), read / resolved timestamps, emailed flag. |
| `email_outbox` | Every e-mail notification is queued here (recipient, subject, body, status, attempts, last error, sent at). Sent through SMTP when `SMTP_URL` is configured, otherwise kept in the outbox and visible to the administrator. |
| `approval_records` | One history table for every approval decision in the system: flight quotations, activity verifications, expense verification, **final clearance** and **deployment** requests — requested by / at, decided by / at, decision, remarks. |
| `deployments` | Deployment of a cleared employee: site / work location, supervisor, planned reporting date (requested by Operations), approval, **actual reporting date** and who confirmed it. |
| `system_settings` | New keys: reminder intervals (days before the planned date, on the due date, daily when overdue), e-mail on/off, passport and document expiry alert windows. |

## 2. Workflows

### Document management
Central repository across all employees: filter by category, employee, project, expiry window; preview, download, upload, version history. **Expiry alerts** for documents with an expiry date and for passports (from the candidate record). Access: `documents.view` / `documents.upload`; photographs remain visible to anyone who can see the candidate. Downloads are audited.

### Financial tracking
* Finance (or any role with `finance.manage`) records estimated and actual costs per employee and category, with supplier, invoice and payment details and the invoice file.
* **Flight tickets are recorded automatically** when a ticket is issued (actual = ticket cost, supplier = travel agency); cancelling the booking zeroes that line.
* **Verification**: a finance user other than the one who recorded the line verifies or rejects it (rule 13). Verified lines are locked; rejecting returns them for correction.
* Automatic calculations: total estimated, total actual, variance (actual − estimated, and %), average cost per employee, totals per project, per recruitment agency, per nationality and per category.

### Notifications & reminders
A notification engine runs on start-up, every hour and on demand. It evaluates the current state and **creates, re-raises or resolves** notifications — no duplicates, and items disappear when the condition is fixed.

| Notification | Recipients |
|---|---|
| Upcoming candidate travel (arrival within 3 days) | Mobility, Accommodation |
| Flight booking pending (joining within 21 days, no ticket) | Mobility |
| Airport pickup not assigned (arrival within 72 h) | Mobility |
| Accommodation not allocated (ticketed or arrived, no bed) | Accommodation |
| Medical appointment pending (arrived, no visa medical scheduled) | Medical |
| Medical examination overdue | Medical |
| Visa processing delays | PRO |
| Training not completed (overdue) | Training |
| Uniform / PPE not distributed (overdue) | owning department |
| Onboarding activity reminders: *N days before*, *on the due date*, *daily when overdue* (configurable) | Responsible person |
| Passport approaching expiry | Recruitment, HR, PRO |
| Awaiting final clearance | HR Manager |
| Employee ready for deployment | Operations |

E-mail copies go to the outbox when e-mail notifications are enabled in Settings and the user has an address.

### Final clearance (Module 10)
The clearance review evaluates ten checks from the checklist: employment documentation verified · immigration formalities · medical examinations · mandatory training · trade competency · uniform & PPE · company induction · accommodation · employee file · project/site induction. The **HR Manager** (`clearance.approve`) approves only when every check passes → activity 46 completed, status **Ready for Deployment**, Operations notified. Rejection requires remarks and is recorded.

### Deployment
1. Operations (`deployment.manage`) requests deployment: site / location, supervisor, planned reporting date.
2. HR Manager / Management approves (not the requester) → activity 47 completed.
3. Operations confirms the **actual reporting to work** → activity 48 completed, status **Deployed**.
An employee is never marked Deployed just because onboarding finished.

### Approvals inbox
One page listing everything waiting for the signed-in user's decision: flight quotations, activity verifications, expense verifications, final clearances and deployment requests.
