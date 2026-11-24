// Phase 2 integration tests: flight booking workflow, approvals, pickups, accommodation capacity.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, login, pdf, validCandidate, type Client } from './harness.ts';

let agencyId = 0, otherAgencyId = 0, vehicleId = 0, roomId = 0, mobilityUserId = 0;

async function newCandidate(hr: Client, over: Record<string, unknown> = {}) {
  const r = await hr.req('POST', '/api/candidates', validCandidate(over));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as number;
}
const status = async (id: number) => (await db.one('SELECT status FROM candidates WHERE id = $1', [id]))!.status;

before(async () => {
  const mob = await login('mobility');
  const ag = await mob.req('POST', '/api/masters/travel_agencies', { name: 'Test Travels LLC', phone: '+971 4 111 2222', is_approved: true });
  assert.equal(ag.status, 201, JSON.stringify(ag.body));
  agencyId = ag.body.id;
  otherAgencyId = (await mob.req('POST', '/api/masters/travel_agencies', { name: 'Unvetted Tours', is_approved: false })).body.id;
  vehicleId = (await mob.req('POST', '/api/masters/vehicles', { registration_no: 'DXB T 99999', name: 'Toyota Hiace', vehicle_type: 'van', seats: 12 })).body.id;
  mobilityUserId = (await db.one("SELECT id FROM users WHERE username = 'mobility'"))!.id;
  const acc = await login('accommodation');
  const camp = await acc.req('POST', '/api/accommodation/camps', { name: 'Test Camp', emirate: 'Dubai' });
  assert.equal(camp.status, 201, JSON.stringify(camp.body));
  assert.equal((await acc.req('POST', '/api/accommodation/rooms', { camp_id: camp.body.id, room_number: 'T1', bed_capacity: 2 })).status, 201);
  roomId = (await db.one("SELECT id FROM accommodation_rooms WHERE room_number = 'T1'"))!.id;
});

describe('flight booking workflow', () => {
  test('quotes → approval by someone else → ticket → pickup → arrival', async () => {
    const hr = await login('hr.manager');
    const mob = await login('mobility');
    const ceo = await login('ceo');
    const cid = await newCandidate(hr);

    const b = await mob.req('POST', '/api/bookings', { candidate_id: cid, departure_country: 'India', departure_city: 'Kochi', arrival_airport: 'DXB', preferred_travel_date: '2026-12-10' });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.match(b.body.booking_no, /^FB-\d{4}-\d{5}$/);
    assert.equal(await status(cid), 'pre_arrival'); // travel request moves a Selected candidate into pre-arrival
    const id = b.body.id;
    assert.equal((await mob.req('POST', '/api/bookings', { candidate_id: cid, departure_country: 'India', departure_city: 'Kochi', arrival_airport: 'DXB', preferred_travel_date: '2026-12-10' })).status, 409);

    const quote = (agency: number, fare: string, dep: string, arr: string) => mob.req('POST', `/api/bookings/${id}/quotations`,
      { travel_agency_id: agency, airline: 'Emirates', flight_number: 'EK 531', departure_at: dep, arrival_at: arr, fare, baggage_allowance: '30 kg' });
    assert.equal((await quote(otherAgencyId, '900', '2026-12-10T04:15', '2026-12-10T07:05')).status, 400); // not approved agency
    const q1 = await quote(agencyId, '1150.00', '2026-12-10T04:15', '2026-12-10T07:05');
    const q2 = await quote(agencyId, '980.50', '2026-12-10T22:40', '2026-12-11T01:30');
    assert.equal(q1.status, 201, JSON.stringify(q1.body));
    assert.equal(q2.status, 201);
    assert.equal((await quote(agencyId, '10', '2026-12-10T10:00', '2026-12-05T10:00')).status, 400); // arrival before departure

    assert.equal((await mob.req('POST', `/api/bookings/${id}/submit`, { quotation_id: q2.body.id })).status, 200);
    // Mobility cannot approve (no permission); CEO can, and approval copies the chosen quote.
    assert.equal((await mob.req('POST', `/api/bookings/${id}/decide`, { decision: 'approve' })).status, 403);
    assert.equal((await ceo.req('POST', `/api/bookings/${id}/decide`, { decision: 'reject' })).status, 400); // reason required
    assert.equal((await ceo.req('POST', `/api/bookings/${id}/decide`, { decision: 'approve' })).status, 200);
    let bk = (await mob.req('GET', `/api/bookings/${id}`)).body.booking;
    assert.equal(bk.status, 'approved');
    assert.equal(bk.ticket_cost, '980.50');
    assert.equal(bk.arrival_at, '2026-12-11 01:30:00');

    assert.equal((await mob.req('POST', `/api/bookings/${id}/book`, { booking_reference: 'pnr7x2', booking_confirmation_date: '2026-11-20' })).status, 200);
    const issueForm = (withFile: boolean) => {
      const fd = new FormData();
      fd.append('flight_number', 'EK 533'); fd.append('departure_at', '2026-12-10T22:40'); fd.append('arrival_at', '2026-12-11T01:30'); fd.append('arrival_terminal', 'T3');
      if (withFile) fd.append('file', new Blob([pdf()]), 'eticket.pdf');
      return mob.req('POST', `/api/bookings/${id}/issue`, undefined, fd);
    };
    assert.equal((await issueForm(false)).status, 400); // e-ticket is mandatory
    const iss = await issueForm(true);
    assert.equal(iss.status, 200, JSON.stringify(iss.body));
    assert.equal(await status(cid), 'travel_confirmed');
    const doc = await db.one("SELECT category FROM employee_documents WHERE candidate_id = $1 AND category = 'flight_ticket'", [cid]);
    assert.ok(doc);

    bk = (await mob.req('GET', `/api/bookings/${id}`)).body;
    assert.equal(bk.pickup.status, 'pending');
    assert.equal(bk.pickup.terminal, 'T3');
    const pid = bk.pickup.id;
    assert.equal((await mob.req('POST', `/api/pickups/${pid}/complete`, { actual_pickup_at: '2026-12-11T02:10' })).status, 400); // not assigned yet
    assert.equal((await mob.req('PUT', `/api/pickups/${pid}/assign`, { vehicle_id: vehicleId, driver_name: 'Ravi', driver_phone: '+971 50 123 4567', coordinator_id: mobilityUserId })).status, 200);
    await db.query("UPDATE vehicles SET registration_no = 'CHANGED' WHERE id = $1", [vehicleId]);
    assert.equal((await mob.req('POST', `/api/pickups/${pid}/complete`, { actual_pickup_at: '2026-12-11T02:10' })).status, 200);
    const p = await db.one('SELECT status, vehicle_registration FROM airport_pickups WHERE id = $1', [pid]);
    assert.equal(p!.status, 'completed');
    assert.equal(p!.vehicle_registration, 'DXB T 99999'); // snapshot kept
    assert.equal(await status(cid), 'arrived');
    assert.equal((await db.one('SELECT status FROM flight_bookings WHERE id = $1', [id]))!.status, 'travel_completed');
  });

  test('a user cannot approve a request they submitted (rule 13)', async () => {
    const hr = await login('hr.manager');
    await db.query(`INSERT INTO role_permissions(role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'hr_manager' AND p.code = 'mobility.manage' ON CONFLICT DO NOTHING`);
    const cid = await newCandidate(hr);
    const b = (await hr.req('POST', '/api/bookings', { candidate_id: cid, departure_country: 'Nepal', departure_city: 'Kathmandu', arrival_airport: 'AUH', preferred_travel_date: '2026-12-20' })).body;
    const q = (await hr.req('POST', `/api/bookings/${b.id}/quotations`, { travel_agency_id: agencyId, airline: 'Etihad', departure_at: '2026-12-20T10:00', arrival_at: '2026-12-20T13:00', fare: '1200' })).body;
    await hr.req('POST', `/api/bookings/${b.id}/submit`, { quotation_id: q.id });
    const self = await hr.req('POST', `/api/bookings/${b.id}/decide`, { decision: 'approve' });
    assert.equal(self.status, 403);
    assert.match(self.body.error, /another approver/);
    const rej = await (await login('ceo')).req('POST', `/api/bookings/${b.id}/decide`, { decision: 'reject', remarks: 'Too expensive' });
    assert.equal(rej.status, 200);
    assert.equal((await db.one('SELECT status FROM flight_bookings WHERE id = $1', [b.id]))!.status, 'quotation_received');
  });

  test('cancelling an issued ticket returns the candidate to pre-arrival and cancels the pickup', async () => {
    const hr = await login('hr.manager');
    const mob = await login('mobility');
    const cid = await newCandidate(hr);
    const b = (await mob.req('POST', '/api/bookings', { candidate_id: cid, departure_country: 'India', departure_city: 'Chennai', arrival_airport: 'SHJ', preferred_travel_date: '2026-12-12' })).body;
    const q = (await mob.req('POST', `/api/bookings/${b.id}/quotations`, { travel_agency_id: agencyId, airline: 'Air Arabia', flight_number: 'G9 472', departure_at: '2026-12-12T05:00', arrival_at: '2026-12-12T08:00', fare: '700' })).body;
    await mob.req('POST', `/api/bookings/${b.id}/submit`, { quotation_id: q.id });
    await (await login('ceo')).req('POST', `/api/bookings/${b.id}/decide`, { decision: 'approve' });
    await mob.req('POST', `/api/bookings/${b.id}/book`, { booking_reference: 'ABC123', booking_confirmation_date: '2026-11-21' });
    const fd = new FormData();
    fd.append('flight_number', 'G9 472'); fd.append('departure_at', '2026-12-12T05:00'); fd.append('arrival_at', '2026-12-12T08:00');
    fd.append('file', new Blob([pdf()]), 't.pdf');
    assert.equal((await mob.req('POST', `/api/bookings/${b.id}/issue`, undefined, fd)).status, 200);
    assert.equal(await status(cid), 'travel_confirmed');
    assert.equal((await mob.req('POST', `/api/bookings/${b.id}/cancel`, { reason: 'Visa delay' })).status, 200);
    assert.equal(await status(cid), 'pre_arrival');
    assert.equal((await db.one('SELECT status FROM airport_pickups WHERE flight_booking_id = $1', [b.id]))!.status, 'cancelled');
  });
});

describe('accommodation', () => {
  test('capacity can never be exceeded, also under concurrent requests', async () => {
    const hr = await login('hr.manager');
    const acc = await login('accommodation');
    const ids = [];
    for (let i = 0; i < 3; i++) { const id = await newCandidate(hr); await hr.req('POST', `/api/candidates/${id}/status`, { action: 'pre_arrival' }); ids.push(id); }
    const a1 = await acc.req('POST', '/api/accommodation/allocations', { candidate_id: ids[0], room_id: roomId });
    assert.equal(a1.status, 201, JSON.stringify(a1.body));
    assert.equal(a1.body.bed_number, 1);
    assert.equal((await acc.req('POST', '/api/accommodation/allocations', { candidate_id: ids[1], room_id: roomId, bed_number: 1 })).status, 409); // bed taken
    assert.equal((await acc.req('POST', '/api/accommodation/allocations', { candidate_id: ids[1], room_id: roomId, bed_number: 3 })).status, 400); // beyond capacity
    // Two coordinators race for the last bed: exactly one wins.
    const race = await Promise.all([
      acc.req('POST', '/api/accommodation/allocations', { candidate_id: ids[1], room_id: roomId }),
      acc.req('POST', '/api/accommodation/allocations', { candidate_id: ids[2], room_id: roomId }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await db.one("SELECT count(*)::int AS n FROM accommodation_allocations WHERE room_id = $1 AND status IN ('allocated','checked_in')", [roomId]))!.n, 2);
    // Capacity cannot be reduced below occupancy, and the database itself refuses an over-capacity bed.
    assert.equal((await acc.req('PUT', `/api/accommodation/rooms/${roomId}`, { bed_capacity: 1 })).status, 409);
    await assert.rejects(db.query("INSERT INTO accommodation_allocations(candidate_id, room_id, bed_number) VALUES ($1, $2, 5)", [ids[2], roomId]));
    const ov = (await acc.req('GET', '/api/accommodation/overview')).body;
    const camp = ov.camps.find((c: any) => c.name === 'Test Camp');
    assert.equal(camp.capacity, 2);
    assert.equal(camp.available, 0);
  });

  test('check-in requires arrival; cancelling the candidate releases the reservation', async () => {
    const hr = await login('hr.manager');
    const acc = await login('accommodation');
    await acc.req('POST', '/api/accommodation/rooms', { camp_id: (await db.one("SELECT id FROM accommodation_camps WHERE name = 'Test Camp'"))!.id, room_number: 'T2', bed_capacity: 4 });
    const room2 = (await db.one("SELECT id FROM accommodation_rooms WHERE room_number = 'T2'"))!.id;
    const cid = await newCandidate(hr);
    const al = (await acc.req('POST', '/api/accommodation/allocations', { candidate_id: cid, room_id: room2 })).body;
    const ci = await acc.req('POST', `/api/accommodation/allocations/${al.id}/checkin`, { actual_checkin_date: '2026-11-01' });
    assert.equal(ci.status, 409);
    assert.match(ci.body.error, /not arrived/);
    assert.equal((await acc.req('POST', '/api/accommodation/allocations', { candidate_id: (await newCandidate(hr, { gender: 'female', full_name: 'Test Female' })), room_id: room2 })).status, 409); // male room
    await hr.req('POST', `/api/candidates/${cid}/status`, { action: 'cancel', reason: 'Withdrew', cancel_category: 'candidate_withdrew' });
    assert.equal((await db.one('SELECT status FROM accommodation_allocations WHERE id = $1', [al.id]))!.status, 'cancelled');
  });

  test('mobility coordinator cannot allocate rooms; operations cannot create bookings', async () => {
    const mob = await login('mobility');
    assert.equal((await mob.req('POST', '/api/accommodation/allocations', { candidate_id: 1, room_id: roomId })).status, 403);
    assert.equal((await mob.req('GET', '/api/accommodation/overview')).status, 200);
    const ops = await login('operations');
    assert.equal((await ops.req('POST', '/api/bookings', { candidate_id: 1 })).status, 403);
  });
});
