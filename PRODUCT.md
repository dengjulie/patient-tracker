# Patient Tracker: Product Decisions

Providers need to record and view their patients' critical data: name, date of
birth, status, and address.

**Guiding principle:** the original requirements (the PRD) are a starting
point, not the final word. Wherever the healthcare standard **FHIR** (HL7's
model for health data, used by Epic, Cerner and others) already answers a
question, we follow FHIR over the PRD. FHIR captures decades of hard-won lessons
about real patients that a short PRD can't.

We also **don't overengineer**. Each decision below solves a real problem for
real patients today, and anything speculative is listed under *Not doing*.

---

## 1. Names: follow FHIR `HumanName`, not "First / Middle / Last"

**PRD said:** First, Middle, Last.

**Problem:** "First, middle, last" is a Western assumption:
- Some people have one name only (common in Indonesia and parts of India).
- Some cultures put the family name first (China, Korea, Hungary).
- Some people have two surnames (Spanish naming conventions).
- In some cultures a "last name" isn't a family name at all (in Eritrea, a
  son's family name is his father's first name).

A form that forces three boxes either rejects these patients or records their
names wrong.

**Decision:** model the name the way FHIR does.

| Field | FHIR | Required? | Why |
| --- | --- | --- | --- |
| Prefix | `prefix` | No | Dr., Mx., Rev. Some patients want to be addressed this way. |
| Given names | `given` (a list) | One of given / family | First and middle names are both "given" names; there can be any number. |
| Family name | `family` | One of given / family | |
| Suffix | `suffix` | No | **Patient safety.** A father and son with the same name and address, told apart only by "Jr.", are a classic cause of mixed-up records. |
| Preferred name | a name with `use = usual` | No | How the patient wants to be addressed, e.g. "Bobby" for Robert. Matters for trans patients and anyone with a nickname. Shown as *Robert (Bobby) Smith*. |

- **Required:** at least a given name **or** a family name. This is the US
  Core FHIR rule, and it means people with only one name can be registered.
- **Characters:** any characters are accepted (O'Brien, José, Nguyễn,
  Smith-Jones). There is deliberately no "letters only" rule.

## 2. Date of birth: required

**PRD said:** date of birth.

**Decision:** keep it required. FHIR makes `birthDate` optional, but clinical
safety practice is to confirm **two identifiers** before treating a patient
(The Joint Commission's National Patient Safety Goal). In practice those two
are almost always **name + date of birth**. Without a DOB, two patients with
the same name are hard to tell apart.

Dates in the future are rejected.

## 3. Address: US only, kept simple

**PRD said:** address.

**Decision:** support **US addresses only**, using FHIR's address field names
(`line`, `city`, `state`, `postalCode`).

- **Why US-only is a product choice, not just a shortcut:**
  - US clinicians are licensed by state, and for telehealth they can generally
    only treat patients located in states where they hold a license. So the
    state is legally meaningful.
  - Insurance and billing are US-specific too.
- **Fields:** street (required), apt/unit (optional), city, state, ZIP.
- **State:** a **dropdown**, not free text. It covers the 50 states, DC, the
  US territories (PR, GU, VI, AS, MP) and military addresses (AA, AE, AP).
  This rules out typos like "ZZ".
- **ZIP:** 5 digits or ZIP+4. It is stored as text so leading zeros survive
  (Boston is 02110).
- **No country field.** Going international would mean per-country address
  formats (as Stripe and Shopify do). That is real work for a need we don't
  have yet, so we're intentionally not building it.

## 4. Status: follow FHIR, not the PRD's sales funnel

**PRD said:** Inquiry, Onboarding, Active, Churned.

**Problem:** these are sales and CRM terms, not clinical ones.
- **"Churned" lumps together very different endings:** a patient who
  completed treatment, one who stopped showing up, and one who never started.
  Clinicians treat those situations differently.
- **No "on hold":** there's nowhere to put a patient who is paused, e.g.
  during a hospital stay or travel.
- **Other tools use clinical words:** SimplePractice uses
  Prospective / Active / Inactive / Archived.

**Decision:** use FHIR's care-episode status list (`EpisodeOfCare.status`).

| Status | Meaning |
| --- | --- |
| **Planned** | Expected to start care. Intake, eligibility checks and onboarding happen here. |
| **Waitlist** | Waiting for a spot before care can begin. |
| **Active** | Currently receiving care. |
| **On hold** | Care is temporarily paused (e.g. hospital stay, travel). |
| **Finished** | Care is complete; no further care is expected. |
| **Cancelled** | Ended before or outside the normal path (never started, withdrew). |
| *Entered in error* | Not chosen directly. Set when a provider deletes a record (see §5). |

- **New patients start as Planned.**
- **Each status shows its one-line meaning in the form**, so every provider
  uses the terms the same way.

## 5. Delete: mark as "entered in error", never erase

**PRD said:** nothing (we added delete).

**Problem:** medical records generally must be kept for years (US state
retention laws). A permanent delete also can't be undone after a misclick.

**Decision:** follow FHIR's own pattern.
- **Deleting** a patient sets their status to **entered in error** and hides
  them from the list. The record stays in the database.
- **Confirmation:** the app asks the provider to confirm before deleting.

## 6. Viewing and finding patients

- **Layout:** one screen, with a patient table and a modal form for adding and
  editing. The table stays in view while working.
- **Search:** covers **names (including preferred name) and date of birth
  only**. It ignores case and accents: "jose munoz" finds *José Muñoz*.
  - Typing "maria garcia" finds *Maria Elena Garcia*, because each word is
    matched separately.
  - Typing "1984" or "03/12/1984" finds patients by DOB.
- **Status filter:** a filter next to search.
- **Sorted by most recently updated first.** New and just-edited patients
  appear at the top, which suits day-to-day work ("who did we just
  onboard?"). We considered alphabetical by last name, the convention in
  clinical patient lists; search covers finding a specific patient by name.
  Letting providers choose (column sorting) is on the Later list.
- **A browsable table** of all patients, not search-only. This is a
  small-practice tool, and seeing your patient list at a glance is expected
  (SimplePractice works the same way). Search-first, as in hospital EHRs, is
  on the Later list for hospital scale.
- **Table columns:** Name · Date of birth (with age) · Status · City, State ·
  Updated. "Updated" makes the sort order visible: recent changes read as
  relative time ("3 hours ago", "yesterday"), older ones as a date ("Oct 12,
  2026"), with the exact time on hover.
  The full address is stored, but shown only when you open a patient to edit.
  That limits what's visible over a provider's shoulder (see §7).
- **Paging:** 25 patients per page, with numbered page buttons and
  "Showing 26–50 of 255". Changing the search or the status filter goes back
  to page 1. Paging happens on the server, so the browser never loads the
  whole patient list. That keeps it fast at hospital scale and means only
  the patients actually shown are recorded as viewed in the audit log.
- **Adding and editing:** an "Add patient" button, or click a patient's name
  (a real button, so it works from the keyboard).
  - **Name labels:** "First (given) name", "Middle name(s)" and "Last (family)
    name": familiar words, with the FHIR meaning in brackets. Under the last
    name: "Leave blank if the patient has only one name."
  - **Status:** each option shows its one-line meaning; new patients default
    to Planned.
  - **State:** a searchable dropdown ("CA — California").
  - **Errors:** shown under the field they belong to.
  - **No autofill:** the browser and password managers can't fill the
    provider's own name or address into a patient's record.
  - **Two providers editing the same patient:** if someone else saved the
    patient after the form was opened, the save is refused with "Someone else
    changed this patient while you were editing. Close the form and open the
    patient again to see their changes." Nobody's changes are silently
    overwritten. This is FHIR's version check (`If-Match`). Merging the two
    edits automatically is more than a small practice needs.
  - **Accidental closing:** clicking outside the modal doesn't close it, so a
    stray click can't throw away what was typed.
  - **After saving,** a notification confirms it and the list jumps to page 1,
    where the patient now sits at the top.
- **Deleting:** from the edit form, with a confirmation that says when to use
  it: "Use this only for records created by mistake… If care has ended, set
  the status to Finished instead." This steers providers away from deleting
  discharged patients.
- **Search timing:** results update **as you type**, debounced (~300 ms after
  the last keystroke) so we don't send a request on every key. If an older
  response arrives after a newer one, it's ignored.

---

## 7. Security and privacy

**PRD said:** nothing. But this app holds health data, so HIPAA's Security
Rule (45 CFR 164.312) sets the baseline.

**Do we need to hide patient details from providers?** No.
- **HIPAA:** the "minimum necessary" rule doesn't apply to providers
  accessing records for treatment (45 CFR 164.502(b)), which is why EHRs
  show full details to clinicians.
- **Safety:** masking would *hurt* patients. Staff confirm two identifiers
  (name + date of birth) before treating someone, and a masked
  `M**** G*****` makes it harder to tell similar patients apart.
- **Where protection comes from:** controlling **who gets in and recording
  what they do**, not hiding data from authorized users.

**What counts as PHI here.** PHI (protected health information) is health
information linked to an identifiable person. HIPAA lists 18 identifiers
(45 CFR 164.514(b)(2)).

| Data | PHI? | Why |
| --- | --- | --- |
| Patient name, date of birth, street, city, ZIP | **Yes** | All on HIPAA's identifier list (dates more specific than the year; areas smaller than a state). |
| Patient status | **Yes**, alongside identity | Being a patient of a practice, and the state of care, is health information. |
| Patient `id` | **Yes** | It works like a medical record number. |
| State alone | No | State level is explicitly allowed. |
| Provider name, email, IP address | PII, not PHI | Staff data. It needs protecting, but HIPAA's PHI rules don't cover it. |

So almost all patient data is PHI, and so are **search terms** (names and
birth dates) and **audit log entries** (patient ids). Rules that follow:
- **Never log request bodies.** If request logging is added, it records only
  method, path, status code and user.
- **Seed data is fake** and must stay that way.
- **The audit log is protected like patient data.**

**What we build for the MVP:**

**What we build for the MVP:**

| HIPAA safeguard | Decision | Why |
| --- | --- | --- |
| Access control | **Login required** for every page and API call. | Each person has their own account, so actions can be traced to them. |
| Who can see what | **Every provider sees all patients in the practice.** | Matches how small practices share coverage (vacations, on-call). Per-provider lists would add ownership and transfers. |
| Account creation | **Created by an admin (script); no sign-up page.** | Healthcare accounts are issued by the practice. Public sign-up would let anyone on the internet see patient data. Reviewers get a demo login. |
| Automatic logoff | **Sessions end after 15 minutes of inactivity.** Anything typed in an unsaved form is **discarded**, not restored after logging back in. | Unattended screens in clinics are a common exposure. Restoring drafts would mean keeping unsaved patient data in the browser. |
| Audit controls | **An append-only audit log** (details below). | HIPAA requires it (164.312(b)), and it's how snooping, bad edits and breaches get investigated. |
| Data in URLs | **Search terms are sent in the request body, never the URL.** | URLs end up in logs and browser history; leaking names and birth dates through them is a common exposure. |
| Shoulder surfing | **The list shows City, State only**; the full address appears when editing. | Shows what's needed to recognize a patient, nothing more. |

**The audit log.** HIPAA requires recording activity (164.312(b)) and
regularly reviewing it (164.308(a)(1)(ii)(D)). It doesn't say what to log,
so we follow the fields certified EHRs use (ONC 170.315(d)(2), based on the
ASTM E2147 standard).

| Event | What's recorded |
| --- | --- |
| Create, edit, or delete (entered-in-error) a patient | Who, when, the action, the patient id |
| **Search** | Who, when, and the **ids of every patient shown in the results**. A search reveals patients, so it counts as viewing them. |
| Login success, login failure, logout | Who (or the email attempted), when |

Every entry also records the IP address of the request.

- **Ids, not details:** entries hold patient ids, never names or search
  terms. That keeps the log's exposure small. It's still PHI, though (see
  above).
- **Append-only:** the app only ever adds entries; it has no code to change
  or delete them.
- **Reviewing it:** for the MVP, by querying the database. A review screen is
  on the Later list. Since HIPAA requires regular review, it's a high
  priority.

## MVP scope

The MVP is the **bare minimum** code that meets the requirements with the
decisions above: log in; add, list, search/filter, edit, and delete patients;
and an audit log of those actions. Everything else
goes on the list below.

## Later (post-MVP)

**To test**
- **Hospital-scale data.** Load a realistic volume (hundreds of thousands to
  millions of patients, as in large health systems) and check:
  - Search speed: `ILIKE '%word%'` scans the whole table, so we'll likely need
    a `pg_trgm` index (and an indexable unaccent wrapper).
  - Page queries: `OFFSET` gets slower on deep pages of very large tables;
    keyset ("seek") pagination may be needed.
  - Seeding: `npm run seed -- <count>` already generates fake patients;
    it may need bulk inserts for millions of rows.

**Product features**
- **Import patients from CSV**, for practices moving over from spreadsheets
  or another system. Considerations:
  - Validate every row with the same rules as the form, and show a per-row
    error report instead of failing the whole file.
  - Flag likely duplicates (same name + date of birth) before importing.
  - Map spreadsheet columns to our fields (e.g. "DOB" → date of birth).
  - Record the import in the audit log.
- **Audit log review screen** (high priority: HIPAA requires regular
  review), plus database-level append-only enforcement, before/after values
  for edits, and a retention policy (commonly 6 years)
- Warn before closing the form with unsaved changes
- **Search-first at hospital scale:** no browse-all list, as in hospital EHRs
- Column sorting
- Multiple addresses per patient (home vs mailing) and address history, in a
  separate addresses table
- Address verification against USPS data, to standardize "St" vs "Street"
  and reduce duplicate patients
- Partial birth dates (FHIR allows `1984` or `1984-03`) for patients whose
  exact date of birth is unknown
- A detail view per patient (with the `GET /api/patients/:id` endpoint)
- A reason for each status change ("lost to follow-up" vs "moved away") and
  status history
- Multiple names per patient beyond a preferred name, e.g. maiden names or
  name history
- Duplicate-patient warning when a new patient has the same name + DOB as an
  existing one
- Restore a patient marked "entered in error"
- Multi-factor authentication (MFA), password change and reset
- Login rate limiting and account lockout after repeated failed attempts
- Roles and permissions (e.g. front desk vs clinician), "break the glass"
  access to restricted records, and an admin screen for accounts
- Multiple practices in one app
- HTTPS and deployment (required in production for HIPAA transmission security)

**Intentionally not doing** (unless the need changes)
- International addresses and a country field (§3)
- Gender and sex fields (US Core includes them, but they are out of scope for
  this request)

## Open questions

- **Patients without a fixed address.** Patients experiencing homelessness
  can't fill in the address fields, and FHIR makes address optional. Right
  now, address is required. Should it become optional?
