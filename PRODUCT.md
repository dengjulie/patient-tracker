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
  only**.
  - Typing "maria garcia" finds *Maria Elena Garcia*, because each word is
    matched separately.
  - Typing "1984" or "03/12/1984" finds patients by DOB.
- **Status filter:** a filter next to search.
- **Table columns:** Name · Date of birth (with age) · Status · City, State.
  The full address shows when editing. *(Default; not yet confirmed.)*
- **Search timing:** results update **as you type**, debounced (~300 ms after
  the last keystroke) so we don't send a request on every key. If an older
  response arrives after a newer one, it's ignored.

---

## MVP scope

The MVP is the **bare minimum** that meets the requirements with the decisions
above: add, list, search/filter, edit, and delete patients. Everything else
goes on the list below.

## Later (post-MVP)

**To test**
- **Hospital-scale data.** Load a realistic volume (hundreds of thousands to
  millions of patients, as in large health systems) and check:
  - Search speed: `LIKE '%word%'` scans the whole table, so we may need
    SQLite full-text search (FTS5).
  - List size: the list currently returns every match, so it will need
    pagination or a result limit.
  - Seeding: we'll need a script that generates realistic fake patients.

**Product features**
- Column sorting and pagination
- A detail view per patient (with the `GET /api/patients/:id` endpoint)
- A reason for each status change ("lost to follow-up" vs "moved away") and
  status history
- Multiple names per patient beyond a preferred name, e.g. maiden names or
  name history
- Duplicate-patient warning when a new patient has the same name + DOB as an
  existing one
- Restore a patient marked "entered in error"
- Authentication, and multiple providers/practices

**Intentionally not doing** (unless the need changes)
- International addresses and a country field (§3)
- Gender and sex fields (US Core includes them, but they are out of scope for
  this request)

## Open questions

- **Patients without a fixed address.** Patients experiencing homelessness
  can't fill in the address fields, and FHIR makes address optional. Right
  now, address is required. Should it become optional?
