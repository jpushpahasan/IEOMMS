// Demo data for evaluation and training. Deterministic (seeded random) so screenshots are repeatable.
import { db } from '../db/index.ts';
import { hashPassword } from '../lib/auth.ts';
import { seedPhase3 } from './seed-phase3.ts';
import { seedPhase4 } from './seed-phase4.ts';

export const DEMO_PASSWORD = 'Welcome@2026';

let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFrom = (n: number) => iso(new Date(Date.now() + n * 864e5));

export async function seedDemo() {
  const ins = async (sql: string, p: unknown[]) => (await db.one(sql, p))!.id as number;
  const clients = [
    await ins(`INSERT INTO clients(name, contact_person, phone, email) VALUES ('ADNOC Onshore','Khalid Al Mansoori','+971 2 602 0000','contracts@client-a.example') RETURNING id`, []),
    await ins(`INSERT INTO clients(name, contact_person, phone, email) VALUES ('Emaar Properties','Sara Haddad','+971 4 367 3333','projects@client-b.example') RETURNING id`, []),
    await ins(`INSERT INTO clients(name, contact_person, phone, email) VALUES ('Dubai Health Authority','Dr. Omar Rahman','+971 4 219 8888','hr@client-c.example') RETURNING id`, []),
  ];
  const projects = [
    await ins(`INSERT INTO projects(code, name, client_id, location, emirate) VALUES ('RUW-24','Ruwais Plant Maintenance',$1,'Ruwais Industrial Area','Abu Dhabi') RETURNING id`, [clients[0]]),
    await ins(`INSERT INTO projects(code, name, client_id, location, emirate) VALUES ('CRK-11','Dubai Creek Harbour Tower C',$1,'Dubai Creek Harbour','Dubai') RETURNING id`, [clients[1]]),
    await ins(`INSERT INTO projects(code, name, client_id, location, emirate) VALUES ('DHA-07','Rashid Hospital Staffing',$1,'Oud Metha','Dubai') RETURNING id`, [clients[2]]),
    await ins(`INSERT INTO projects(code, name, client_id, location, emirate) VALUES ('HBR-03','Hamriyah Port Logistics',$1,'Hamriyah Free Zone','Sharjah') RETURNING id`, [clients[0]]),
  ];
  const agencies = [
    await ins(`INSERT INTO recruitment_agencies(name, country, licence_no, contact_person, phone, email) VALUES ('Kerala Overseas Manpower','India','RA-B-0921/KER','Anil Kumar','+91 484 400 1200','ops@agency-in.example') RETURNING id`, []),
    await ins(`INSERT INTO recruitment_agencies(name, country, licence_no, contact_person, phone, email) VALUES ('Kathmandu Global HR','Nepal','DoFE-1188/074','Sita Shrestha','+977 1 441 2200','info@agency-np.example') RETURNING id`, []),
    await ins(`INSERT INTO recruitment_agencies(name, country, licence_no, contact_person, phone, email) VALUES ('Manila Skilled Workforce Inc.','Philippines','DMW-LB-112-2023','Maria Santos','+63 2 8521 7700','deploy@agency-ph.example') RETURNING id`, []),
    await ins(`INSERT INTO recruitment_agencies(name, country, licence_no, contact_person, phone, email) VALUES ('Dhaka Employment Services','Bangladesh','RL-1452','Rahim Uddin','+880 2 955 1100','hr@agency-bd.example') RETURNING id`, []),
  ];
  const tradeDefs: [string, string, string, string][] = [
    ['DRV', 'Heavy Vehicle Driver', 'driver', 'Driver'], ['SCF', 'Scaffolder', 'skilled', 'Scaffolder'], ['RIG', 'Rigger', 'skilled', 'Rigger'],
    ['HLP', 'General Helper', 'unskilled', 'Helper'], ['ELT', 'Electrical Technician', 'skilled', 'Electrical Technician'],
    ['MCT', 'Mechanical Technician', 'skilled', 'Mechanical Technician'], ['NRS', 'Registered Nurse', 'medical', 'Staff Nurse'],
    ['WLD', 'Welder (6G)', 'skilled', 'Welder'], ['HSE', 'HSE Officer', 'staff', 'HSE Officer'],
  ];
  const trades: { id: number; pos: string; cat: string }[] = [];
  for (const [code, name, cat, pos] of tradeDefs) trades.push({ id: await ins('INSERT INTO trades(code, name, category) VALUES ($1,$2,$3) RETURNING id', [code, name, cat]), pos, cat });

  const hash = await hashPassword(DEMO_PASSWORD);
  const users: [string, string, string, string | null][] = [
    ['ceo', 'Faisal Al Hammadi', 'management', null], ['hr.manager', 'Priya Menon', 'hr_manager', 'HR'],
    ['recruiter', 'Joseph Mathew', 'recruitment', 'REC'], ['mobility', 'Aisha Karim', 'mobility', 'MOB'],
    ['pro', 'Hassan Ali', 'pro', 'PRO'], ['medical', 'Dr. Leena Thomas', 'medical', 'MED'],
    ['training', 'Mark D\'Souza', 'training', 'TRN'], ['accommodation', 'Rajesh Pillai', 'accommodation', 'ACC'],
    ['finance', 'Nadia Yousef', 'finance', 'FIN'], ['operations', 'Imran Qureshi', 'operations', 'OPS'],
  ];
  const userIds: Record<string, number> = {};
  for (const [u, name, role, dept] of users) {
    userIds[u] = await ins(`INSERT INTO users(username, full_name, email, password_hash, role_id, department_id, must_change_password)
      SELECT $1, $2, $6, $3, r.id, (SELECT id FROM departments WHERE code = $5), FALSE FROM roles r WHERE r.code = $4 RETURNING id`, [u, name, hash, role, dept, `${u}@ieomms.local`]);
  }

  const people: Record<string, { first: string[]; last: string[]; agency: number }> = {
    India: { first: ['Arun', 'Suresh', 'Vijay', 'Rahul', 'Deepak', 'Manoj', 'Anjali', 'Divya'], last: ['Nair', 'Kumar', 'Reddy', 'Sharma', 'Pillai', 'Varghese'], agency: agencies[0] },
    Nepal: { first: ['Ram', 'Bishnu', 'Hari', 'Krishna', 'Sanjay'], last: ['Thapa', 'Gurung', 'Tamang', 'Rai', 'Magar'], agency: agencies[1] },
    Philippines: { first: ['Jose', 'Mark', 'Rodel', 'Angela', 'Maricel', 'Jericho'], last: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia'], agency: agencies[2] },
    Bangladesh: { first: ['Abdul', 'Mohammad', 'Rafiq', 'Kamal', 'Shahid'], last: ['Hossain', 'Rahman', 'Islam', 'Akter', 'Miah'], agency: agencies[3] },
    Pakistan: { first: ['Imran', 'Asif', 'Bilal', 'Usman'], last: ['Khan', 'Ahmed', 'Malik', 'Butt'], agency: 0 },
  };
  const statuses = ['selected', 'selected', 'selected', 'pre_arrival', 'pre_arrival', 'pre_arrival', 'pre_arrival', 'on_hold', 'cancelled'];
  const year = new Date().getFullYear();
  let n = 0;
  for (let i = 0; i < 46; i++) {
    const nat = pick(Object.keys(people));
    const p = people[nat];
    const trade = pick(trades);
    const female = trade.cat === 'medical' ? rnd() < 0.8 : rnd() < 0.05;
    const first = female ? pick(['Anjali', 'Divya', 'Angela', 'Maricel', 'Sunita', 'Grace']) : pick(p.first.filter((x) => !['Anjali', 'Divya', 'Angela', 'Maricel'].includes(x)));
    const name = `${first} ${pick(p.last)}`;
    const sel = daysFrom(-Math.floor(rnd() * 300) - 3);
    const join = iso(new Date(new Date(sel).getTime() + (20 + Math.floor(rnd() * 70)) * 864e5));
    const issue = daysFrom(-Math.floor(rnd() * 3200) - 200);
    let expiry = iso(new Date(new Date(issue).getTime() + 3652 * 864e5));
    if (i % 11 === 3) expiry = daysFrom(60 + i * 2); // a few passports expiring soon
    if (expiry <= daysFrom(30)) expiry = daysFrom(400 + i * 10);
    const dob = daysFrom(-(365 * (22 + Math.floor(rnd() * 25)) + Math.floor(rnd() * 300)));
    const status = pick(statuses);
    const basic = trade.cat === 'medical' ? 9000 : trade.cat === 'staff' ? 8000 : trade.cat === 'unskilled' ? 1200 : trade.cat === 'driver' ? 2200 : 1800 + Math.floor(rnd() * 8) * 100;
    const ref = `IEO-${year}-${String(++n).padStart(5, '0')}`;
    const project = trade.cat === 'medical' ? projects[2] : pick([projects[0], projects[1], projects[3]]);
    const id = await ins(`INSERT INTO candidates(reference_no, full_name, gender, date_of_birth, nationality, marital_status, contact_number, email,
        current_address, emergency_contact_name, emergency_contact_relation, emergency_contact_phone, passport_number, passport_issue_date,
        passport_expiry_date, passport_issuing_country, position, trade_id, department_id, project_id, work_location, employment_category,
        basic_salary, housing_allowance, transport_allowance, food_allowance, other_allowance, contract_status, offer_letter_status, selection_date,
        expected_joining_date, recruitment_agency_id, source_country, recruitment_coordinator_id, educational_qualifications, work_experience,
        previous_uae_experience, status, status_reason, cancel_category, status_before_hold, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,(SELECT id FROM departments WHERE code='OPS'),$19,$20,$21,$22,$23,$24,$25,0,$26,$27,$28,$29,$30,$5,$31,$32,$33,$34,$35,$36,$37,$38,$31) RETURNING id`,
    [ref, name, female ? 'female' : 'male', dob, nat, pick(['single', 'married', 'married']), `+${pick(['91', '977', '63', '880', '92'])} ${Math.floor(7e9 + rnd() * 2e9)}`,
      `${first.toLowerCase()}.${i}@mail.example`, `${pick(['House 12', 'Flat 4B', 'Ward 7', 'Block C'])}, ${pick(['Kochi', 'Pokhara', 'Cebu', 'Sylhet', 'Lahore', 'Chennai'])}`,
      `${pick(p.first)} ${pick(p.last)}`, pick(['Spouse', 'Father', 'Mother', 'Brother']), `+${pick(['91', '977', '63', '880'])} ${Math.floor(7e9 + rnd() * 2e9)}`,
      `${nat.slice(0, 1)}${Math.floor(1e6 + rnd() * 8.9e6)}`, issue, expiry, nat, trade.pos, trade.id, project,
      project === projects[2] ? 'Rashid Hospital, Dubai' : pick(['Site office', 'Main plant', 'Tower C site']),
      trade.cat === 'staff' || trade.cat === 'medical' ? 'staff' : 'labour', basic, trade.cat === 'staff' || trade.cat === 'medical' ? 2500 : 0,
      300, trade.cat === 'unskilled' || trade.cat === 'skilled' ? 0 : 0,
      status === 'pre_arrival' ? pick(['prepared', 'sent', 'signed']) : 'not_prepared', status === 'pre_arrival' ? 'accepted' : pick(['not_issued', 'issued']),
      sel, join, p.agency || null, userIds.recruiter, trade.cat === 'medical' ? 'B.Sc Nursing' : pick(['Secondary School', 'ITI Diploma', 'Higher Secondary']),
      `${2 + Math.floor(rnd() * 12)} years as ${trade.pos}`, rnd() < 0.25, status,
      status === 'cancelled' ? 'Candidate accepted another offer' : status === 'on_hold' ? 'Awaiting client headcount approval' : null,
      status === 'cancelled' ? 'candidate_withdrew' : null, status === 'on_hold' ? 'pre_arrival' : null]);
    await db.query(`INSERT INTO candidate_status_history(candidate_id, from_status, to_status, reason, changed_by, changed_at) VALUES ($1,NULL,'selected','Candidate registered',$2,$3)`, [id, userIds.recruiter, `${sel}T10:00:00+04:00`]);
    if (status !== 'selected') {
      if (status !== 'cancelled') await db.query(`INSERT INTO candidate_status_history(candidate_id, from_status, to_status, changed_by, changed_at) VALUES ($1,'selected','pre_arrival',$2,$3)`, [id, userIds['hr.manager'], `${sel}T15:00:00+04:00`]);
      if (status !== 'pre_arrival') await db.query(`INSERT INTO candidate_status_history(candidate_id, from_status, to_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5)`,
        [id, status === 'cancelled' ? 'selected' : 'pre_arrival', status, status === 'cancelled' ? 'Candidate accepted another offer' : 'Awaiting client headcount approval', userIds['hr.manager']]);
    }
  }
  await db.query(`INSERT INTO reference_counters(key, year, last_value) VALUES ('candidate', $1, $2)`, [year, n]);
  await db.query(`INSERT INTO system_settings(key, value) VALUES ('company_name', '"Gulf Industrial Services LLC"') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await seedPhase2(userIds);
  await seedPhase3(userIds);
  await seedPhase4(userIds);
}

// ------------------------------------------------------------------ Phase 2: mobility & accommodation
const ts = (days: number, hhmm: string) => `${daysFrom(days)} ${hhmm}`;

async function seedPhase2(userIds: Record<string, number>) {
  const ins = async (sql: string, p: unknown[]) => (await db.one(sql, p))!.id as number;
  const mob = userIds.mobility, ceo = userIds.ceo, acc = userIds.accommodation;
  const agencies = [
    await ins(`INSERT INTO travel_agencies(name, contact_person, phone, email, office_location, payment_terms, is_approved) VALUES
      ('Al Rais Travels','Shibu Thomas','+971 4 214 7777','corporate@travel-a.example','Bur Dubai, Dubai','30 days credit',TRUE) RETURNING id`, []),
    await ins(`INSERT INTO travel_agencies(name, contact_person, phone, email, office_location, payment_terms, is_approved) VALUES
      ('Musafir Corporate','Ayesha Siddiqui','+971 4 359 9000','b2b@travel-b.example','Deira, Dubai','15 days credit',TRUE) RETURNING id`, []),
    await ins(`INSERT INTO travel_agencies(name, contact_person, phone, email, office_location, payment_terms, is_approved) VALUES
      ('Emirates Holidays Business','Peter Lobo','+971 4 230 9999','groups@travel-c.example','Al Garhoud, Dubai','Advance payment',TRUE) RETURNING id`, []),
  ];
  await db.query(`INSERT INTO travel_agencies(name, contact_person, phone, office_location, payment_terms, is_approved) VALUES
    ('Sky Wings Tourism','Karim Nasser','+971 6 555 1212','Al Nahda, Sharjah','Advance payment',FALSE)`);
  const vehicles = [
    await ins(`INSERT INTO vehicles(registration_no, name, vehicle_type, seats, driver_name, driver_phone) VALUES ('DXB P 48213','Toyota Hiace','van',12,'Sameer Khan','+971 50 441 2290') RETURNING id`, []),
    await ins(`INSERT INTO vehicles(registration_no, name, vehicle_type, seats, driver_name, driver_phone) VALUES ('AD 12 66410','Nissan Urvan','van',14,'Joseph Raj','+971 55 302 7781') RETURNING id`, []),
    await ins(`INSERT INTO vehicles(registration_no, name, vehicle_type, seats, driver_name, driver_phone) VALUES ('DXB K 20931','Ashok Leyland Falcon','bus',32,'Gurpreet Singh','+971 52 610 4450') RETURNING id`, []),
  ];

  // Camps and rooms
  const camps = [
    await ins(`INSERT INTO accommodation_camps(name, location, emirate, supervisor_name, supervisor_phone, facilities) VALUES
      ('Al Quoz Labour Camp','Al Quoz Industrial Area 4','Dubai','Mohan Das','+971 50 778 1200','Mess hall, laundry, Wi-Fi, prayer room, recreation area, clinic visits twice weekly') RETURNING id`, []),
    await ins(`INSERT INTO accommodation_camps(name, location, emirate, supervisor_name, supervisor_phone, facilities) VALUES
      ('Mussafah Staff Village','ICAD Residential City, Mussafah','Abu Dhabi','Tariq Mahmood','+971 55 120 3344','Catering, laundry, gym, Wi-Fi, transport to Ruwais site') RETURNING id`, []),
    await ins(`INSERT INTO accommodation_camps(name, location, emirate, supervisor_name, supervisor_phone, facilities) VALUES
      ('Oud Metha Staff Residence','Oud Metha, near Rashid Hospital','Dubai','Grace Fernandes','+971 52 889 6677','Furnished apartments, kitchenette, Wi-Fi, security') RETURNING id`, []),
  ];
  const rooms: { id: number; cap: number; gender: string; camp: number }[] = [];
  const room = async (camp: number, block: string, no: string, type: string, cap: number, gender = 'male', status = 'active') => {
    const id = await ins(`INSERT INTO accommodation_rooms(camp_id, block, room_number, room_type, bed_capacity, gender, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [camp, block, no, type, cap, gender, status]);
    if (status === 'active') rooms.push({ id, cap, gender, camp });
  };
  for (const b of ['A', 'B']) for (let r = 1; r <= 8; r++) await room(camps[0], `Block ${b}`, `${b}${100 + r}`, 'shared', 6, 'male', b === 'B' && r === 8 ? 'maintenance' : 'active');
  for (let r = 1; r <= 6; r++) await room(camps[1], 'Villa 3', `30${r}`, r <= 2 ? 'supervisor' : 'double', r <= 2 ? 1 : 2);
  for (let r = 1; r <= 5; r++) await room(camps[2], 'Tower 1', `5${String(r).padStart(2, '0')}`, 'double', 2, 'female');
  await room(camps[2], 'Tower 1', '601', 'double', 2, 'male');

  // Bookings at every stage for pre-arrival candidates
  const cands = await db.many(`SELECT c.id, c.full_name, c.gender, c.nationality, c.project_id, t.category AS trade_cat FROM candidates c JOIN trades t ON t.id = c.trade_id
    WHERE c.status = 'pre_arrival' ORDER BY c.id`);
  const city: Record<string, [string, string, string, string][]> = {
    India: [['Kochi', 'EK', 'Emirates', 'COK'], ['Chennai', 'AI', 'Air India Express', 'MAA'], ['Mumbai', '6E', 'IndiGo', 'BOM']],
    Nepal: [['Kathmandu', 'FZ', 'flydubai', 'KTM'], ['Kathmandu', 'G9', 'Air Arabia', 'KTM']],
    Philippines: [['Manila', 'EK', 'Emirates', 'MNL'], ['Cebu', '5J', 'Cebu Pacific', 'CEB']],
    Bangladesh: [['Dhaka', 'BG', 'Biman Bangladesh', 'DAC'], ['Sylhet', 'EK', 'Emirates', 'ZYL']],
    Pakistan: [['Lahore', 'PK', 'PIA', 'LHE'], ['Islamabad', 'EY', 'Etihad Airways', 'ISB']],
  };
  const plan = ['pending_booking', 'pending_booking', 'quotation_received', 'quotation_received', 'approval_pending', 'approval_pending', 'approved',
    'ticket_booked', 'issued:0', 'issued:0', 'issued:1', 'issued:1', 'issued:2', 'issued:4', 'issued:6', 'done:-1', 'done:-3', 'done:-6', 'done:-12'];
  const usedBeds = new Map<number, number>();
  const takeBed = (gender: string, preferCamp: number) => {
    const ordered = [...rooms.filter((r) => r.camp === preferCamp), ...rooms.filter((r) => r.camp !== preferCamp)];
    const r = ordered.find((x) => (x.gender === gender || x.gender === 'any') && (usedBeds.get(x.id) || 0) < x.cap && x.cap > 1);
    if (!r) return null;
    const bed = (usedBeds.get(r.id) || 0) + 1;
    usedBeds.set(r.id, bed);
    return { room: r.id, bed };
  };
  const projects = await db.many('SELECT id, emirate FROM projects');
  let n = 0;
  for (let i = 0; i < Math.min(plan.length, cands.length); i++) {
    const c = cands[i];
    const [stage, offRaw] = plan[i].split(':');
    const off = Number(offRaw || 0);
    const [depCity, code, airline] = pick(city[c.nationality] || city.India);
    const emirate = projects.find((p) => p.id === c.project_id)?.emirate;
    const airport = emirate === 'Abu Dhabi' ? 'AUH' : emirate === 'Sharjah' ? 'SHJ' : 'DXB';
    const travelDay = stage === 'issued' || stage === 'done' ? off : 10 + i;
    const arrH = 1 + Math.floor(rnd() * 20);
    const arrival = ts(travelDay, `${String(arrH).padStart(2, '0')}:${pick(['05', '20', '35', '50'])}`);
    const departure = ts(travelDay, `${String(Math.max(0, arrH - 4)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`);
    const fno = `${code} ${100 + Math.floor(rnd() * 800)}`;
    const fare = (650 + Math.floor(rnd() * 900)).toFixed(2);
    const status = stage === 'issued' ? 'ticket_issued' : stage === 'done' ? 'travel_completed' : stage;
    const year = new Date().getFullYear();
    const bno = `FB-${year}-${String(++n).padStart(5, '0')}`;
    const ticketed = ['approved', 'ticket_booked', 'ticket_issued', 'travel_completed'].includes(status);
    const bid = await ins(`INSERT INTO flight_bookings(booking_no, candidate_id, departure_country, departure_city, arrival_airport, preferred_travel_date,
        confirmed_travel_date, airline, flight_number, departure_at, arrival_at, arrival_terminal, baggage_allowance, ticket_cost, travel_agency_id,
        booking_reference, status, booking_confirmation_date, requested_by, submitted_by, approved_by, approved_at, created_by, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$19, now() - interval '20 days') RETURNING id`,
    [bno, c.id, c.nationality, depCity, airport, daysFrom(travelDay), ticketed ? daysFrom(travelDay) : null, ticketed ? airline : null, ticketed ? fno : null,
      ticketed ? departure : null, ticketed ? arrival : null, ticketed ? (airport === 'DXB' ? pick(['T1', 'T3']) : 'T1') : null, ticketed ? '30 kg' : null,
      ticketed ? fare : null, ticketed ? agencies[i % 3] : null, ['ticket_booked', 'ticket_issued', 'travel_completed'].includes(status) ? `${code}${Math.floor(1e5 + rnd() * 9e5)}` : null,
      status, ['ticket_booked', 'ticket_issued', 'travel_completed'].includes(status) ? daysFrom(Math.min(travelDay, 0) - 7) : null, mob,
      ['approval_pending', 'approved', 'ticket_booked', 'ticket_issued', 'travel_completed'].includes(status) ? mob : null,
      ticketed ? ceo : null, ticketed ? `${daysFrom(Math.min(travelDay, 0) - 10)}T11:00:00+04:00` : null]);
    // Quotations (2–3 per booking past "pending")
    if (status !== 'pending_booking') {
      const nq = 2 + (i % 2);
      let selected = 0;
      for (let k = 0; k < nq; k++) {
        const f = k === 0 && ticketed ? fare : (650 + Math.floor(rnd() * 900)).toFixed(2);
        const qid = await ins(`INSERT INTO flight_quotations(booking_id, travel_agency_id, quote_reference, airline, flight_number, departure_at, arrival_at, baggage_allowance, fare, valid_until, created_by, is_selected)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'30 kg',$8,$9,$10,$11) RETURNING id`,
        [bid, agencies[(i + k) % 3], `Q-${bid}-${k + 1}`, k === 0 && ticketed ? airline : pick(['Emirates', 'flydubai', 'Air Arabia', 'Etihad Airways']),
          k === 0 && ticketed ? fno : `${pick(['EK', 'FZ', 'G9', 'EY'])} ${100 + Math.floor(rnd() * 800)}`, departure, arrival, f, daysFrom(14), mob,
          k === 0 && status !== 'quotation_received']);
        if (k === 0) selected = qid;
      }
      if (status !== 'quotation_received') await db.query('UPDATE flight_bookings SET selected_quotation_id = $2 WHERE id = $1', [bid, selected]);
    }
    if (status === 'ticket_issued' || status === 'travel_completed') {
      const assigned = status === 'travel_completed' || i % 3 !== 0;
      const v = vehicles[i % 3];
      const vr = await db.one('SELECT registration_no, driver_name, driver_phone FROM vehicles WHERE id = $1', [v]);
      await db.query(`INSERT INTO airport_pickups(candidate_id, flight_booking_id, arrival_at, airport, terminal, flight_number, vehicle_id, vehicle_registration,
          driver_name, driver_phone, coordinator_id, status, actual_pickup_at, remarks, confirmed_by)
        VALUES ($1,$2,$3,$4,(SELECT arrival_terminal FROM flight_bookings WHERE id = $2),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [c.id, bid, arrival, airport, fno, assigned ? v : null, assigned ? vr!.registration_no : null, assigned ? vr!.driver_name : null, assigned ? vr!.driver_phone : null,
        assigned ? mob : null, status === 'travel_completed' ? 'completed' : assigned ? 'assigned' : 'pending',
        status === 'travel_completed' ? arrival.slice(0, 11) + String(Math.min(23, arrH + 1)).padStart(2, '0') + ':10' : null,
        status === 'travel_completed' ? 'Received at arrivals hall, original passport sighted' : null, status === 'travel_completed' ? mob : null]);
      const newStatus = status === 'travel_completed' ? 'arrived' : 'travel_confirmed';
      await db.query(`UPDATE candidates SET status = $2, status_changed_at = now() WHERE id = $1`, [c.id, newStatus]);
      await db.query(`INSERT INTO candidate_status_history(candidate_id, from_status, to_status, reason, changed_by, changed_at) VALUES ($1,'pre_arrival','travel_confirmed',$2,$3,$4)`,
        [c.id, `Ticket issued: ${fno} arriving ${airport} ${arrival}`, mob, `${daysFrom(Math.min(travelDay, 0) - 5)}T12:00:00+04:00`]);
      if (newStatus === 'arrived') {
        await db.query(`INSERT INTO candidate_status_history(candidate_id, from_status, to_status, reason, changed_by, changed_at) VALUES ($1,'travel_confirmed','arrived',$2,$3,$4)`,
          [c.id, `Picked up at ${airport}`, mob, `${arrival.replace(' ', 'T')}:00+04:00`]);
      }
      // Accommodation: arrived → checked in; most confirmed travellers → bed reserved
      if (newStatus === 'arrived' || i % 4 !== 1) {
        const preferCamp = c.trade_cat === 'medical' ? camps[2] : emirate === 'Abu Dhabi' ? camps[1] : camps[0];
        const b = takeBed(c.gender, preferCamp);
        if (b) {
          await db.query(`INSERT INTO accommodation_allocations(candidate_id, room_id, bed_number, allocation_date, expected_checkin_date, actual_checkin_date, status, checkin_confirmed_by, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [c.id, b.room, b.bed, daysFrom(Math.min(travelDay, 0) - 4), daysFrom(travelDay),
            newStatus === 'arrived' ? daysFrom(travelDay) : null, newStatus === 'arrived' ? 'checked_in' : 'allocated', newStatus === 'arrived' ? acc : null, acc]);
        }
      }
    }
  }
  await db.query(`INSERT INTO reference_counters(key, year, last_value) VALUES ('flight_booking', $1, $2)`, [new Date().getFullYear(), n]);
}
