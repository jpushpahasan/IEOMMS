# Phase 2 — International Mobility & Accommodation

## 1. Database changes

### Mobility
| Table | Purpose |
|---|---|
| `travel_agencies` | Approved travel agency master: name, contact person, phone, email, office location, payment terms, `is_approved`, `is_active`. Only approved, active agencies can quote. |
| `flight_bookings` | One travel request per candidate (`FB-2026-00001`). Route (departure country/city → UAE arrival airport), preferred and confirmed travel dates, airline, flight number, local departure and UAE arrival date-times, transit, baggage, ticket cost, agency, PNR / booking reference, status (8 statuses), e-ticket document, booking confirmation date, requested / approved by. Only one non-cancelled booking per candidate. |
| `flight_quotations` | Several quotes per booking from different agencies (airline, flight, times, transit, baggage, fare, validity). One quote can be selected; its details are copied to the booking on approval. |
| `vehicles` | Pickup vehicles: registration number, type, seats, default driver name and phone. |
| `airport_pickups` | One pickup per booking: arrival date/time, airport, terminal, flight, vehicle + registration, driver name and phone (saved on the pickup, so later vehicle edits don't rewrite history), coordinator, status (pending → assigned → completed / no-show / cancelled), actual pickup time, arrival remarks. |

### Accommodation
| Table | Purpose |
|---|---|
| `accommodation_camps` | Camp / building: name, location, emirate, supervisor name and phone, facilities, status (active / under maintenance / closed). |
| `accommodation_rooms` | Room in a camp: block/building, room number, room type, bed capacity, gender designation, facilities, status. Occupied and available beds are calculated from allocations, never typed in. |
| `accommodation_allocations` | Candidate → room + bed number: allocation date, expected and actual check-in, check-out, status (allocated → checked in → checked out / cancelled), who confirmed check-in. |

Capacity rules are enforced **in the database** as well as in the API:
* unique index: one active allocation per bed (`room_id, bed_number`) and one per candidate;
* trigger: bed number must be between 1 and the room's capacity, and the room and camp must be active;
* a room's capacity cannot be reduced below its current occupancy.
The API also locks the room row while allocating, so two coordinators cannot take the last bed at the same time.

### New permissions
`approvals.self` — approve one's own requests (Super Administrator only; enforces business rule 13). HR Manager additionally receives `mobility.approve`.

## 2. Workflows

### Flight booking
```
Pending Booking ──add quote──▶ Quotation Received ──select quote & submit──▶ Approval Pending
      ▲                                ▲                                           │
      │                                └──────────── rejected (reason) ◀──────────┤
      │                                                                     approve│ (not by the requester)
Cancelled ◀── any time before travel completes (reason)                           ▼
                                   Ticket Issued ◀── e-ticket + PNR ── Ticket Booked ◀── PNR / booking ref ── Approved
                                        │
                                        └── arrival confirmed ──▶ Travel Completed
```
* Quotations from several agencies are compared side by side (cheapest and fastest are highlighted).
* Approving copies the chosen quote's airline, flight, times, baggage, cost and agency to the booking.
* **Ticket Issued** requires the e-ticket upload, flight number and both times. The e-ticket is filed in the candidate's documents as *Flight Ticket*.

### Effect on the candidate lifecycle (automatic, recorded in the status history)
| Event | Candidate status |
|---|---|
| Ticket issued | Selected / Pre-arrival → **Travel Confirmed** |
| Booking cancelled after issue | Travel Confirmed → **Pre-arrival Processing** |
| Pickup completed or travel marked complete | Travel Confirmed → **Arrived in UAE** |
| Candidate cancelled | open pickups cancelled and accommodation released automatically |

### Airport pickup
* A pickup is created automatically when the ticket is issued, using the flight's airport, terminal and arrival time.
* Mobility assigns a vehicle, driver and coordinator, then confirms the actual pickup time.
* **Alerts:** pickups arriving within 72 hours with no vehicle or driver are listed on the dashboard, mobility overview and pickup schedule.

### Accommodation
* The availability board shows every camp → room → bed (free / reserved / occupied).
* Allocate picks a free bed (or the first free bed automatically). Check-in records the actual date; check-out or cancel frees the bed.
* "Awaiting accommodation" = active candidates past selection (pre-arrival onwards) with no active allocation.

## 3. Screens
* **International Mobility** — KPIs, arrivals calendar (month view), travel agencies, vehicles.
* **Flight Bookings** — booking list by status, booking page with quotation comparison and workflow buttons.
* **Airport Pickup** — schedule grouped by arrival date, assign / confirm, unassigned alerts.
* **Accommodation** — occupancy dashboard, bed board, allocations, camps & rooms setup.
* **Candidate profile** — new *Travel* and *Accommodation* tabs; timeline milestones for ticket, arrival, pickup and accommodation are now live.
* **Dashboard** — arrivals today/tomorrow, upcoming arrivals, pickups pending, tickets awaiting booking, travel spend, country-wise mobilisation, accommodation capacity and occupancy.
