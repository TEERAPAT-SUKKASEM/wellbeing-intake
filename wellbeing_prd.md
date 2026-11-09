# 📄 Requirements Specification: "Wellbeing" Campus Counselling Platform

## 1. Project Overview & Philosophy

* **Project Name:** Wellbeing

* **Core Mission:** Provide a zero-stigma, anonymous, and fast web application for students to request private counselling appointments while guaranteeing physical privacy before and after sessions.

* **Key Design Principles:**

  * **Privacy-First & Anonymous:** No login or personal identity disclosure required to request an appointment.

  * **Fast Access:** 2-click booking path from selection to passcode generation.

  * **Physical Privacy Buffer:** Automated mandatory 15-minute buffer between all sessions to prevent students from encountering each other in entryways or waiting rooms.

## 2. User Roles & Access Control

| Role | Access Level & Authentication | Key Purpose | 
| ----- | ----- | ----- | 
| **Student / Client** | Anonymous / Unauthenticated (Access Passcode tracking) | Browse services, submit anonymous requests, view personal request status using access code. | 
| **Practitioner / Specialist** | Authenticated (Practitioner Account) | View master calendar, manage triage queues, approve/reschedule appointments. | 
| **Administrator** | Authenticated (Admin Privileges) | Configure active service categories and set system time-slot availability. | 

## 3. Key Platform Requirements & Business Logic

### A. Booking & Privacy Rules

1. **Anonymous Identity:** Students can use an optional Alias/Nickname. Legal names, emails, and student ID numbers are strictly optional.

2. **Access Passcode System:** Upon request submission, the system generates a unique Private Access Key (e.g., `WB-9842-X`) stored client-side or retrieved via passcode entry.

3. **15-Minute Privacy Buffer Rule:**

   * When an appointment slot is requested/confirmed (e.g., `10:00 AM - 10:45 AM`), the platform automatically blocks out the subsequent 15 minutes (`10:45 AM - 11:00 AM`) as an unavailable **Privacy & Sanitization Buffer**.

   * Adjacent slots cannot be booked by any user.

4. **Zero Cross-Visibility:** Public slot availability displays strictly as `Available` or `Unavailable`. Public users cannot view appointment counts, user aliases, or practitioner notes.

### B. Intelligent Triage & Fallback Requirements

1. **AI Urgency Assessor:** Analyzes the intake note for urgency cues (Routine vs. Urgent) and displays appropriate mental health emergency disclaimers.

2. **Deterministic Fallback:** A manual toggle switch (*Routine* / *Urgent*) that bypasses AI evaluation when the AI service is offline, disabled, or unselected by the user.

## 4. 3 Core User Journey Screens

### Screen 1: Service Finder & Slot Selector (Student View)

* Category view of active services (e.g., *Academic Stress*, *General Counselling*, *Urgent Drop-in*).

* Direct time-slot picker displaying real-time open slots (incorporating the 15-minute buffer enforcement).

* 1-click transition to the intake step.

### Screen 2: Private Request & AI Triage (Student View)

* Single-page intake form: Optional Alias input, reason for visit text field, and slot selection.

* AI Triage widget: Shows urgency suggestion and safety disclaimers.

* Deterministic fallback toggle switch (*Routine* / *Urgent*).

* Post-submission modal displaying the generated Private Access Key and direct link to status tracking.

### Screen 3: Practitioner Schedule & Triage Desk (Practitioner View)

* Interactive visual timeline showing daily/weekly appointments with clear 15-minute buffer blocks.

* Prioritized incoming request queue sorted by urgency flags (*Urgent* pinned top).

* Quick action buttons: `Approve`, `Reschedule`, `Cancel`.

## 5. REST API Operations & Shared Data Contract

### Shared Data Models (JSON Schemas)

#### `Service`

```json
{
  "id": "srv_123",
  "name": "Academic Stress Counselling",
  "duration_minutes": 45,
  "is_active": true
}
```

#### `AppointmentRequest`

```json
{
  "id": "req_8842",
  "access_key": "WB-8842-X",
  "service_id": "srv_123",
  "alias": "QuietStudent",
  "intake_note": "Feeling overwhelmed with upcoming exams.",
  "urgency_level": "URGENT", 
  "triage_mode": "AI_ASSISTED", 
  "requested_slot_start": "2026-11-10T10:00:00Z",
  "requested_slot_end": "2026-11-10T10:45:00Z",
  "status": "PENDING"
}
```

#### `Slot`

```json
{
  "slot_start": "2026-11-10T10:00:00Z",
  "slot_end": "2026-11-10T10:45:00Z",
  "is_available": true
}
```

### REST API Endpoints Specification

1. **`GET /api/v1/services`**

   * **Purpose:** Retrieve active counselling services.

   * **Response:** `200 OK` → `Array<Service>`

2. **`GET /api/v1/slots?service_id={id}&date={YYYY-MM-DD}`**

   * **Purpose:** Fetch available slots, automatically excluding booked times and their enforced 15-minute buffers.

   * **Response:** `200 OK` → `Array<Slot>`

3. **`POST /api/v1/requests`**

   * **Purpose:** Submit an anonymous appointment request.

   * **Request Body:** `{ service_id, alias, intake_note, manual_urgency, requested_slot_start }`

   * **Response:** `201 Created` → `{ id, access_key, status, urgency_level }`

4. **`GET /api/v1/requests/me?access_key={key}`**

   * **Purpose:** Retrieve request status using the Private Access Key.

   * **Response:** `200 OK` → `AppointmentRequest`

5. **`POST /api/v1/requests/{id}/cancel`**

   * **Purpose:** Cancel a request anonymously via access key validation.

   * **Request Body:** `{ access_key }`

   * **Response:** `200 OK` → `{ id, status: "CANCELLED" }`

6. **`GET /api/v1/practitioner/queue`**

   * **Purpose:** Fetch practitioner queue sorted by urgency (Requires Practitioner Auth Header).

   * **Response:** `200 OK` → `Array<AppointmentRequest>`

7. **`PATCH /api/v1/requests/{id}/status`**

   * **Purpose:** Practitioner approves, reschedules, or rejects a request.

   * **Request Body:** `{ status: "CONFIRMED" | "REJECTED" }`

   * **Response:** `200 OK` → `AppointmentRequest`

## 6. Inter-Team Integration (Webhook)

* **Published Event:** `appointment.confirmed`

* **Trigger:** Fired when a practitioner confirms a request.

* **Recipient:** Notification Hub / Reminder Service.

* **Payload Boundary (Zero Sensitive Data):**

  ```json
  {
    "event_type": "appointment.confirmed",
    "appointment_id": "req_8842",
    "scheduled_time": "2026-11-10T10:00:00Z",
    "privacy_buffer_end": "2026-11-10T11:00:00Z"
  }
  ```

* **AI & Fallback Workflow for Triage Integrations:**

  * **AI-Assisted Path:** Evaluates intake notes using NLP to assign urgency (`ROUTINE` vs `URGENT`) and attach guidance disclaimers.

  * **Deterministic Fallback Path:** If AI processing fails or is disabled by user setting, fallback executes a keyword matcher rule (e.g., matching keywords like "crisis", "help", "urgent") combined with the student's manual toggle choice.

## 7. Automated Testing Plan (7 Essential Test Paths)

| Test ID | Test Category | Target Feature / Flow | Expected Outcome | 
| ----- | ----- | ----- | ----- | 
| **TEST-01** | Privacy Boundary | Anonymous request submission (`POST /requests`) | Verifies request succeeds without requiring email, legal identity, or auth token. | 
| **TEST-02** | Business Logic | **15-Minute Privacy Buffer Enforcement** | Verifies that booking a slot (`10:00-10:45`) automatically hides the `10:45-11:00` buffer slot from subsequent `GET /slots` calls. | 
| **TEST-03** | Core Flow | Status check via access passcode (`GET /requests/me`) | Verifies valid access key returns accurate status while invalid key returns `404 Not Found`. | 
| **TEST-04** | Core Flow | Anonymous cancellation (`POST /requests/{id}/cancel`) | Verifies request status switches to `CANCELLED` and immediately releases the reserved slot + buffer. | 
| **TEST-05** | Role Boundary | Practitioner queue access without credentials | Verifies unauthenticated calls to `GET /practitioner/queue` are rejected with `401 Unauthorized`. | 
| **TEST-06** | AI & Fallback | AI Triage processing failure | Verifies system successfully defaults to manual urgency selection and fallback emergency links when AI service returns an error. | 
| **TEST-07** | Inter-team Webhook | Outbound confirmation notification | Verifies `appointment.confirmed` webhook fires on status update without exposing personal intake text. | 