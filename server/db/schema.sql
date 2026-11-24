-- IEOMMS database schema (PostgreSQL). Idempotent: safe to run on every start.
-- Phase 1: security, reference data, candidates, documents, audit.

-- ------------------------------------------------------------------ security
CREATE TABLE IF NOT EXISTS roles (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(40)  NOT NULL UNIQUE,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  is_system     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS permissions (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(60) NOT NULL UNIQUE,
  module        VARCHAR(40) NOT NULL,
  description   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS departments (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(20)  NOT NULL UNIQUE,
  name          VARCHAR(100) NOT NULL UNIQUE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id                    SERIAL PRIMARY KEY,
  username              VARCHAR(60)  NOT NULL UNIQUE,
  full_name             VARCHAR(150) NOT NULL,
  email                 VARCHAR(150),
  phone                 VARCHAR(30),
  password_hash         TEXT NOT NULL,
  role_id               INT NOT NULL REFERENCES roles(id),
  department_id         INT REFERENCES departments(id),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password  BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts       INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            INT REFERENCES users(id),
  updated_at            TIMESTAMPTZ,
  updated_by            INT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

ALTER TABLE departments ADD COLUMN IF NOT EXISTS manager_user_id INT REFERENCES users(id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    CHAR(64) PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  ip            VARCHAR(64),
  user_agent    VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INT REFERENCES users(id) ON DELETE SET NULL,
  username      VARCHAR(60),
  action        VARCHAR(40) NOT NULL,
  entity        VARCHAR(60) NOT NULL,
  entity_id     INT,
  old_values    JSONB,
  new_values    JSONB,
  ip            VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS system_settings (
  key           VARCHAR(60) PRIMARY KEY,
  value         JSONB NOT NULL,
  updated_by    INT REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ reference data
CREATE TABLE IF NOT EXISTS clients (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(150) NOT NULL UNIQUE,
  contact_person  VARCHAR(150),
  phone           VARCHAR(30),
  email           VARCHAR(150),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(30)  NOT NULL UNIQUE,
  name            VARCHAR(150) NOT NULL,
  client_id       INT REFERENCES clients(id),
  location        VARCHAR(150),
  emirate         VARCHAR(40),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recruitment_agencies (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(150) NOT NULL UNIQUE,
  country         VARCHAR(80),
  licence_no      VARCHAR(80),
  contact_person  VARCHAR(150),
  phone           VARCHAR(30),
  email           VARCHAR(150),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trades (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(30)  NOT NULL UNIQUE,
  name            VARCHAR(100) NOT NULL UNIQUE,
  category        VARCHAR(30)  NOT NULL DEFAULT 'skilled'
                  CHECK (category IN ('professional','staff','skilled','semi_skilled','unskilled','driver','medical')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reference_counters (
  key             VARCHAR(30) NOT NULL,
  year            INT NOT NULL,
  last_value      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (key, year)
);

-- ------------------------------------------------------------------ candidates
CREATE TABLE IF NOT EXISTS candidates (
  id                          SERIAL PRIMARY KEY,
  reference_no                VARCHAR(30) NOT NULL UNIQUE,
  -- A. personal
  full_name                   VARCHAR(150) NOT NULL,
  gender                      VARCHAR(10)  NOT NULL CHECK (gender IN ('male','female')),
  date_of_birth               DATE NOT NULL,
  nationality                 VARCHAR(80)  NOT NULL,
  marital_status              VARCHAR(15)  CHECK (marital_status IN ('single','married','divorced','widowed')),
  contact_number              VARCHAR(30),
  email                       VARCHAR(150),
  current_address             TEXT,
  emergency_contact_name      VARCHAR(150),
  emergency_contact_relation  VARCHAR(60),
  emergency_contact_phone     VARCHAR(30),
  passport_number             VARCHAR(20)  NOT NULL,
  passport_issue_date         DATE NOT NULL,
  passport_expiry_date        DATE NOT NULL,
  passport_issuing_country    VARCHAR(80)  NOT NULL,
  -- B. employment
  position                    VARCHAR(120) NOT NULL,
  trade_id                    INT NOT NULL REFERENCES trades(id),
  department_id               INT REFERENCES departments(id),
  project_id                  INT NOT NULL REFERENCES projects(id),
  work_location               VARCHAR(150),
  employment_category         VARCHAR(20) NOT NULL DEFAULT 'labour'
                              CHECK (employment_category IN ('staff','labour','professional','contract','temporary')),
  basic_salary                NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  housing_allowance           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (housing_allowance >= 0),
  transport_allowance         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (transport_allowance >= 0),
  food_allowance              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (food_allowance >= 0),
  other_allowance             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (other_allowance >= 0),
  total_salary                NUMERIC(12,2) GENERATED ALWAYS AS
                              (basic_salary + housing_allowance + transport_allowance + food_allowance + other_allowance) STORED,
  contract_status             VARCHAR(20) NOT NULL DEFAULT 'not_prepared'
                              CHECK (contract_status IN ('not_prepared','prepared','sent','signed','rejected')),
  offer_letter_status         VARCHAR(20) NOT NULL DEFAULT 'not_issued'
                              CHECK (offer_letter_status IN ('not_issued','issued','accepted','declined')),
  selection_date              DATE NOT NULL,
  expected_joining_date       DATE,
  recruitment_agency_id       INT REFERENCES recruitment_agencies(id),
  source_country              VARCHAR(80),
  recruitment_coordinator_id  INT REFERENCES users(id),
  -- C. additional
  educational_qualifications  TEXT,
  professional_qualifications TEXT,
  work_experience             TEXT,
  licences_certifications     TEXT,
  previous_uae_experience     BOOLEAN NOT NULL DEFAULT FALSE,
  previous_uae_details        TEXT,
  remarks                     TEXT,
  -- lifecycle
  status                      VARCHAR(30) NOT NULL DEFAULT 'selected'
                              CHECK (status IN ('selected','pre_arrival','travel_confirmed','arrived','onboarding',
                                                'awaiting_clearance','ready_for_deployment','deployed','on_hold','cancelled')),
  status_before_hold          VARCHAR(30),
  status_reason               TEXT,
  cancel_category             VARCHAR(30)
                              CHECK (cancel_category IN ('rejected_by_company','candidate_withdrew','medical_unfit','visa_rejected','other')),
  status_changed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_archived                 BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at                 TIMESTAMPTZ,
  archived_by                 INT REFERENCES users(id),
  photo_document_id           INT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                  INT REFERENCES users(id),
  updated_at                  TIMESTAMPTZ,
  updated_by                  INT REFERENCES users(id),
  CONSTRAINT chk_passport_dates CHECK (passport_expiry_date > passport_issue_date),
  CONSTRAINT chk_archive_cancelled CHECK (NOT is_archived OR status = 'cancelled')
);
CREATE INDEX IF NOT EXISTS idx_cand_status   ON candidates(status) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_cand_project  ON candidates(project_id);
CREATE INDEX IF NOT EXISTS idx_cand_trade    ON candidates(trade_id);
CREATE INDEX IF NOT EXISTS idx_cand_agency   ON candidates(recruitment_agency_id);
CREATE INDEX IF NOT EXISTS idx_cand_nat      ON candidates(nationality);
CREATE INDEX IF NOT EXISTS idx_cand_name     ON candidates(lower(full_name));
-- one live candidate per passport
CREATE UNIQUE INDEX IF NOT EXISTS uq_cand_passport_active
  ON candidates(upper(passport_number), passport_issuing_country) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS candidate_status_history (
  id              SERIAL PRIMARY KEY,
  candidate_id    INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  from_status     VARCHAR(30),
  to_status       VARCHAR(30) NOT NULL,
  reason          TEXT,
  changed_by      INT REFERENCES users(id),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_csh_candidate ON candidate_status_history(candidate_id, changed_at);

-- ------------------------------------------------------------------ documents (Module 6 store)
CREATE TABLE IF NOT EXISTS employee_documents (
  id              SERIAL PRIMARY KEY,
  candidate_id    INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  category        VARCHAR(40) NOT NULL CHECK (category IN (
                    'passport','photograph','offer_letter','employment_contract','work_permit','flight_ticket',
                    'visa_medical','occupational_medical','training_certificate','mohre_training','emirates_id',
                    'residence_visa','education_certificate','professional_certificate','uniform_ppe_ack','other')),
  title           VARCHAR(200),
  version         INT NOT NULL DEFAULT 1,
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,
  document_number VARCHAR(60),
  issue_date      DATE,
  expiry_date     DATE,
  original_name   VARCHAR(255) NOT NULL,
  stored_name     VARCHAR(80)  NOT NULL UNIQUE,
  mime_type       VARCHAR(80)  NOT NULL,
  size_bytes      INT NOT NULL,
  sha256          CHAR(64) NOT NULL,
  remarks         TEXT,
  uploaded_by     INT REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_docs_candidate ON employee_documents(candidate_id, category, version DESC);
CREATE INDEX IF NOT EXISTS idx_docs_expiry ON employee_documents(expiry_date) WHERE is_current;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_cand_photo') THEN
    ALTER TABLE candidates ADD CONSTRAINT fk_cand_photo FOREIGN KEY (photo_document_id) REFERENCES employee_documents(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ================================================================== PHASE 2: mobility & accommodation
CREATE TABLE IF NOT EXISTS travel_agencies (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(150) NOT NULL UNIQUE,
  contact_person  VARCHAR(150),
  phone           VARCHAR(30),
  email           VARCHAR(150),
  office_location VARCHAR(200),
  payment_terms   VARCHAR(200),
  is_approved     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id               SERIAL PRIMARY KEY,
  registration_no  VARCHAR(30) NOT NULL UNIQUE,
  name             VARCHAR(100) NOT NULL,
  vehicle_type     VARCHAR(30) NOT NULL DEFAULT 'van' CHECK (vehicle_type IN ('car','van','minibus','bus')),
  seats            INT NOT NULL DEFAULT 7 CHECK (seats BETWEEN 1 AND 80),
  driver_name      VARCHAR(150),
  driver_phone     VARCHAR(30),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flight_bookings (
  id                         SERIAL PRIMARY KEY,
  booking_no                 VARCHAR(30) NOT NULL UNIQUE,
  candidate_id               INT NOT NULL REFERENCES candidates(id),
  departure_country          VARCHAR(80) NOT NULL,
  departure_city             VARCHAR(100) NOT NULL,
  arrival_airport            VARCHAR(5) NOT NULL CHECK (arrival_airport IN ('DXB','DWC','AUH','SHJ','RKT','FJR')),
  preferred_travel_date      DATE NOT NULL,
  confirmed_travel_date      DATE,
  airline                    VARCHAR(100),
  flight_number              VARCHAR(20),
  departure_at               TIMESTAMP,          -- local time at origin
  arrival_at                 TIMESTAMP,          -- UAE local time
  arrival_terminal           VARCHAR(20),
  transit_details            TEXT,
  baggage_allowance          VARCHAR(60),
  ticket_cost                NUMERIC(12,2) CHECK (ticket_cost >= 0),
  travel_agency_id           INT REFERENCES travel_agencies(id),
  booking_reference          VARCHAR(30),
  status                     VARCHAR(20) NOT NULL DEFAULT 'pending_booking' CHECK (status IN
                             ('pending_booking','quotation_received','approval_pending','approved','ticket_booked','ticket_issued','travel_completed','cancelled')),
  selected_quotation_id      INT,
  eticket_document_id        INT REFERENCES employee_documents(id),
  booking_confirmation_date  DATE,
  requested_by               INT REFERENCES users(id),
  submitted_by               INT REFERENCES users(id),
  approved_by                INT REFERENCES users(id),
  approved_at                TIMESTAMPTZ,
  decision_remarks           TEXT,
  cancel_reason              TEXT,
  remarks                    TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                 INT REFERENCES users(id),
  updated_at                 TIMESTAMPTZ,
  updated_by                 INT REFERENCES users(id),
  CONSTRAINT chk_fb_times CHECK (arrival_at IS NULL OR departure_at IS NULL OR arrival_at > departure_at - interval '14 hours')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fb_candidate_open ON flight_bookings(candidate_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_fb_status ON flight_bookings(status);
CREATE INDEX IF NOT EXISTS idx_fb_arrival ON flight_bookings(arrival_at);

CREATE TABLE IF NOT EXISTS flight_quotations (
  id                SERIAL PRIMARY KEY,
  booking_id        INT NOT NULL REFERENCES flight_bookings(id) ON DELETE CASCADE,
  travel_agency_id  INT NOT NULL REFERENCES travel_agencies(id),
  quote_reference   VARCHAR(40),
  airline           VARCHAR(100) NOT NULL,
  flight_number     VARCHAR(20),
  departure_at      TIMESTAMP NOT NULL,
  arrival_at        TIMESTAMP NOT NULL,
  arrival_terminal  VARCHAR(20),
  transit_details   TEXT,
  baggage_allowance VARCHAR(60),
  fare              NUMERIC(12,2) NOT NULL CHECK (fare >= 0),
  valid_until       DATE,
  remarks           TEXT,
  is_selected       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        INT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_fq_booking ON flight_quotations(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fq_selected ON flight_quotations(booking_id) WHERE is_selected;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_fb_quote') THEN
    ALTER TABLE flight_bookings ADD CONSTRAINT fk_fb_quote FOREIGN KEY (selected_quotation_id) REFERENCES flight_quotations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS airport_pickups (
  id                   SERIAL PRIMARY KEY,
  candidate_id         INT NOT NULL REFERENCES candidates(id),
  flight_booking_id    INT NOT NULL UNIQUE REFERENCES flight_bookings(id),
  arrival_at           TIMESTAMP NOT NULL,
  airport              VARCHAR(5) NOT NULL,
  terminal             VARCHAR(20),
  flight_number        VARCHAR(20),
  vehicle_id           INT REFERENCES vehicles(id),
  vehicle_registration VARCHAR(30),
  driver_name          VARCHAR(150),
  driver_phone         VARCHAR(30),
  coordinator_id       INT REFERENCES users(id),
  status               VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','assigned','completed','no_show','cancelled')),
  actual_pickup_at     TIMESTAMP,
  remarks              TEXT,
  confirmed_by         INT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ,
  updated_by           INT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pickup_arrival ON airport_pickups(arrival_at);

CREATE TABLE IF NOT EXISTS accommodation_camps (
  id                SERIAL PRIMARY KEY,
  name              VARCHAR(150) NOT NULL UNIQUE,
  location          VARCHAR(200),
  emirate           VARCHAR(40),
  supervisor_name   VARCHAR(150),
  supervisor_phone  VARCHAR(30),
  facilities        TEXT,
  status            VARCHAR(15) NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','closed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accommodation_rooms (
  id             SERIAL PRIMARY KEY,
  camp_id        INT NOT NULL REFERENCES accommodation_camps(id),
  block          VARCHAR(50),
  room_number    VARCHAR(20) NOT NULL,
  room_type      VARCHAR(20) NOT NULL DEFAULT 'shared' CHECK (room_type IN ('shared','single','double','supervisor','family')),
  bed_capacity   INT NOT NULL CHECK (bed_capacity BETWEEN 1 AND 20),
  gender         VARCHAR(10) NOT NULL DEFAULT 'male' CHECK (gender IN ('male','female','any')),
  facilities     TEXT,
  status         VARCHAR(15) NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','closed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_room_number ON accommodation_rooms(camp_id, coalesce(block, ''), room_number);

CREATE TABLE IF NOT EXISTS accommodation_allocations (
  id                     SERIAL PRIMARY KEY,
  candidate_id           INT NOT NULL REFERENCES candidates(id),
  room_id                INT NOT NULL REFERENCES accommodation_rooms(id),
  bed_number             INT NOT NULL CHECK (bed_number >= 1),
  allocation_date        DATE NOT NULL DEFAULT current_date,
  expected_checkin_date  DATE,
  actual_checkin_date    DATE,
  checkout_date          DATE,
  status                 VARCHAR(15) NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated','checked_in','checked_out','cancelled')),
  checkin_confirmed_by   INT REFERENCES users(id),
  remarks                TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             INT REFERENCES users(id),
  updated_at             TIMESTAMPTZ,
  updated_by             INT REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alloc_bed ON accommodation_allocations(room_id, bed_number) WHERE status IN ('allocated','checked_in');
CREATE UNIQUE INDEX IF NOT EXISTS uq_alloc_candidate ON accommodation_allocations(candidate_id) WHERE status IN ('allocated','checked_in');

-- Defence in depth: capacity can never be exceeded, even by direct SQL.
CREATE OR REPLACE FUNCTION trg_alloc_capacity() RETURNS trigger AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.status NOT IN ('allocated','checked_in') THEN RETURN NEW; END IF;
  SELECT ar.bed_capacity, ar.status AS room_status, ac.status AS camp_status INTO r
    FROM accommodation_rooms ar JOIN accommodation_camps ac ON ac.id = ar.camp_id WHERE ar.id = NEW.room_id;
  IF NEW.bed_number > r.bed_capacity THEN
    RAISE EXCEPTION 'Bed % exceeds room capacity of %', NEW.bed_number, r.bed_capacity USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND (r.room_status <> 'active' OR r.camp_status <> 'active') THEN
    RAISE EXCEPTION 'Room or camp is not available for allocation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS alloc_capacity ON accommodation_allocations;
CREATE TRIGGER alloc_capacity BEFORE INSERT OR UPDATE ON accommodation_allocations FOR EACH ROW EXECUTE FUNCTION trg_alloc_capacity();

CREATE OR REPLACE FUNCTION trg_room_capacity() RETURNS trigger AS $$
DECLARE top INT;
BEGIN
  SELECT max(bed_number) INTO top FROM accommodation_allocations WHERE room_id = NEW.id AND status IN ('allocated','checked_in');
  IF top IS NOT NULL AND NEW.bed_capacity < top THEN
    RAISE EXCEPTION 'Room capacity cannot be reduced below occupied bed %', top USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS room_capacity ON accommodation_rooms;
CREATE TRIGGER room_capacity BEFORE UPDATE OF bed_capacity ON accommodation_rooms FOR EACH ROW EXECUTE FUNCTION trg_room_capacity();

-- ================================================================== PHASE 3: onboarding, medical, visa, training, uniform
CREATE TABLE IF NOT EXISTS onboarding_activity_definitions (
  id                    SERIAL PRIMARY KEY,
  seq                   INT NOT NULL UNIQUE,
  section               CHAR(1) NOT NULL CHECK (section IN ('A','B','C','D','E','F')),
  name                  VARCHAR(150) NOT NULL,
  department_id         INT NOT NULL REFERENCES departments(id),
  is_mandatory          BOOLEAN NOT NULL DEFAULT TRUE,
  requires_document     BOOLEAN NOT NULL DEFAULT FALSE,
  document_category     VARCHAR(40),
  requires_verification BOOLEAN NOT NULL DEFAULT FALSE,
  anchor                VARCHAR(10) NOT NULL DEFAULT 'selection' CHECK (anchor IN ('selection','arrival')),
  offset_days           INT NOT NULL DEFAULT 0,
  workflow_key          VARCHAR(40),
  is_system             BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  description           TEXT
);

CREATE TABLE IF NOT EXISTS onboarding_templates (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(120) NOT NULL UNIQUE,
  trade_id     INT REFERENCES trades(id),
  project_id   INT REFERENCES projects(id),
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_scope ON onboarding_templates(coalesce(trade_id, 0), coalesce(project_id, 0)) WHERE is_active;

CREATE TABLE IF NOT EXISTS onboarding_template_items (
  template_id    INT NOT NULL REFERENCES onboarding_templates(id) ON DELETE CASCADE,
  definition_id  INT NOT NULL REFERENCES onboarding_activity_definitions(id) ON DELETE CASCADE,
  is_applicable  BOOLEAN NOT NULL DEFAULT TRUE,
  is_mandatory   BOOLEAN,
  offset_days    INT,
  PRIMARY KEY (template_id, definition_id)
);

CREATE TABLE IF NOT EXISTS training_courses (
  id               SERIAL PRIMARY KEY,
  code             VARCHAR(30) NOT NULL UNIQUE,
  name             VARCHAR(150) NOT NULL,
  category         VARCHAR(20) NOT NULL CHECK (category IN ('technical','competency','hse','mohre','company_rules','emergency','client')),
  duration_hours   NUMERIC(5,1) NOT NULL DEFAULT 4 CHECK (duration_hours > 0),
  validity_months  INT CHECK (validity_months > 0),
  provider         VARCHAR(150),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_training_requirements (
  trade_id            INT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  course_id           INT NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  is_mandatory        BOOLEAN NOT NULL DEFAULT TRUE,
  requires_assessment BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (trade_id, course_id)
);
CREATE TABLE IF NOT EXISTS project_training_requirements (
  project_id          INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  course_id           INT NOT NULL REFERENCES training_courses(id) ON DELETE CASCADE,
  is_mandatory        BOOLEAN NOT NULL DEFAULT TRUE,
  requires_assessment BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (project_id, course_id)
);

CREATE TABLE IF NOT EXISTS uniform_items (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL UNIQUE,
  category      VARCHAR(20) NOT NULL CHECK (category IN ('uniform','safety_shoes','ppe','id_card')),
  needs_size    BOOLEAN NOT NULL DEFAULT TRUE,
  default_qty   INT NOT NULL DEFAULT 1 CHECK (default_qty BETWEEN 1 AND 20),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_onboarding (
  candidate_id   INT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  template_id    INT REFERENCES onboarding_templates(id),
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by   INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS onboarding_activities (
  id                     SERIAL PRIMARY KEY,
  candidate_id           INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  definition_id          INT NOT NULL REFERENCES onboarding_activity_definitions(id),
  seq                    INT NOT NULL,
  section                CHAR(1) NOT NULL,
  name                   VARCHAR(150) NOT NULL,
  department_id          INT NOT NULL REFERENCES departments(id),
  responsible_user_id    INT NOT NULL REFERENCES users(id),
  planned_date           DATE,
  actual_completion_date DATE,
  status                 VARCHAR(20) NOT NULL DEFAULT 'not_started' CHECK (status IN
                         ('not_started','pending','in_progress','awaiting_documents','awaiting_approval','completed','rejected','on_hold','not_applicable')),
  is_mandatory           BOOLEAN NOT NULL DEFAULT TRUE,
  requires_document      BOOLEAN NOT NULL DEFAULT FALSE,
  document_category      VARCHAR(40),
  requires_verification  BOOLEAN NOT NULL DEFAULT FALSE,
  workflow_key           VARCHAR(40),
  anchor                 VARCHAR(10) NOT NULL DEFAULT 'selection',
  offset_days            INT NOT NULL DEFAULT 0,
  document_id            INT REFERENCES employee_documents(id),
  remarks                TEXT,
  na_reason              TEXT,
  auto_completed         BOOLEAN NOT NULL DEFAULT FALSE,
  submitted_by           INT REFERENCES users(id),
  submitted_at           TIMESTAMPTZ,
  verified_by            INT REFERENCES users(id),
  verified_at            TIMESTAMPTZ,
  verification_remarks   TEXT,
  completed_by           INT REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             INT REFERENCES users(id),
  updated_at             TIMESTAMPTZ,
  updated_by             INT REFERENCES users(id),
  CONSTRAINT chk_completed_date CHECK (status <> 'completed' OR actual_completion_date IS NOT NULL),
  UNIQUE (candidate_id, definition_id)
);
CREATE INDEX IF NOT EXISTS idx_oa_dept ON onboarding_activities(department_id, status);
CREATE INDEX IF NOT EXISTS idx_oa_resp ON onboarding_activities(responsible_user_id, status);
CREATE INDEX IF NOT EXISTS idx_oa_planned ON onboarding_activities(planned_date) WHERE status NOT IN ('completed','not_applicable');

CREATE TABLE IF NOT EXISTS employees (
  id             SERIAL PRIMARY KEY,
  employee_no    VARCHAR(20) NOT NULL UNIQUE,
  candidate_id   INT NOT NULL UNIQUE REFERENCES candidates(id),
  joining_date   DATE NOT NULL,
  file_no        VARCHAR(40),
  remarks        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS visa_medical_records (
  id                 SERIAL PRIMARY KEY,
  candidate_id       INT NOT NULL REFERENCES candidates(id),
  medical_centre     VARCHAR(150) NOT NULL,
  application_no     VARCHAR(40),
  appointment_at     TIMESTAMP,
  attended_date      DATE,
  result             VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','fit','unfit','retest')),
  result_date        DATE,
  certificate_document_id INT REFERENCES employee_documents(id),
  verified_by        INT REFERENCES users(id),
  verified_at        TIMESTAMPTZ,
  remarks            TEXT,
  is_current         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         INT REFERENCES users(id),
  updated_at         TIMESTAMPTZ,
  updated_by         INT REFERENCES users(id),
  CONSTRAINT chk_vm_result CHECK (result = 'pending' OR (result_date IS NOT NULL AND attended_date IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vm_current ON visa_medical_records(candidate_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS occupational_medical_records (
  id                 SERIAL PRIMARY KEY,
  candidate_id       INT NOT NULL REFERENCES candidates(id),
  clinic             VARCHAR(150) NOT NULL,
  appointment_at     TIMESTAMP,
  exam_date          DATE,
  tests_performed    TEXT,
  fitness            VARCHAR(25) NOT NULL DEFAULT 'pending' CHECK (fitness IN ('pending','fit','fit_with_restrictions','temporarily_unfit','unfit')),
  restrictions       TEXT,
  report_date        DATE,
  next_review_date   DATE,
  report_document_id INT REFERENCES employee_documents(id),
  remarks            TEXT,
  is_current         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         INT REFERENCES users(id),
  updated_at         TIMESTAMPTZ,
  updated_by         INT REFERENCES users(id),
  CONSTRAINT chk_om_fitness CHECK (fitness = 'pending' OR (exam_date IS NOT NULL AND report_date IS NOT NULL)),
  CONSTRAINT chk_om_restr CHECK (fitness <> 'fit_with_restrictions' OR coalesce(restrictions, '') <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_om_current ON occupational_medical_records(candidate_id) WHERE is_current;

CREATE TABLE IF NOT EXISTS visa_records (
  id                         SERIAL PRIMARY KEY,
  candidate_id               INT NOT NULL UNIQUE REFERENCES candidates(id),
  entry_permit_required      BOOLEAN NOT NULL DEFAULT TRUE,
  work_permit_no             VARCHAR(40),
  entry_permit_no            VARCHAR(40),
  entry_permit_applied_date  DATE,
  entry_permit_issue_date    DATE,
  entry_permit_expiry_date   DATE,
  residence_application_no   VARCHAR(40),
  residence_application_date DATE,
  residence_status           VARCHAR(15) NOT NULL DEFAULT 'not_started' CHECK (residence_status IN ('not_started','applied','approved','issued','rejected')),
  residence_file_no          VARCHAR(40),
  uid_no                     VARCHAR(20),
  residence_issue_date       DATE,
  residence_expiry_date      DATE,
  eid_application_no         VARCHAR(40),
  eid_biometrics_date        DATE,
  eid_number                 VARCHAR(20),
  eid_expiry_date            DATE,
  eid_collected_date         DATE,
  eid_verified               BOOLEAN NOT NULL DEFAULT FALSE,
  remarks                    TEXT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                 INT REFERENCES users(id),
  updated_at                 TIMESTAMPTZ,
  updated_by                 INT REFERENCES users(id),
  CONSTRAINT chk_eid_format CHECK (eid_number IS NULL OR eid_number ~ '^784-[0-9]{4}-[0-9]{7}-[0-9]$'),
  CONSTRAINT chk_res_issued CHECK (residence_status <> 'issued' OR (residence_issue_date IS NOT NULL AND residence_expiry_date IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS training_records (
  id                      SERIAL PRIMARY KEY,
  candidate_id            INT NOT NULL REFERENCES candidates(id),
  course_id               INT NOT NULL REFERENCES training_courses(id),
  is_mandatory            BOOLEAN NOT NULL DEFAULT TRUE,
  requires_assessment     BOOLEAN NOT NULL DEFAULT FALSE,
  status                  VARCHAR(15) NOT NULL DEFAULT 'required' CHECK (status IN ('required','scheduled','attended','passed','failed','absent','exempted')),
  scheduled_date          DATE,
  completed_date          DATE,
  trainer                 VARCHAR(150),
  score                   NUMERIC(5,1) CHECK (score BETWEEN 0 AND 100),
  expiry_date             DATE,
  certificate_document_id INT REFERENCES employee_documents(id),
  remarks                 TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by              INT REFERENCES users(id),
  updated_at              TIMESTAMPTZ,
  updated_by              INT REFERENCES users(id),
  UNIQUE (candidate_id, course_id),
  CONSTRAINT chk_tr_done CHECK (status NOT IN ('attended','passed','failed') OR completed_date IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS uniform_measurements (
  candidate_id   INT PRIMARY KEY REFERENCES candidates(id),
  shirt_size     VARCHAR(10),
  trouser_size   VARCHAR(10),
  coverall_size  VARCHAR(10),
  shoe_size      VARCHAR(10),
  measured_date  DATE NOT NULL,
  measured_by    INT REFERENCES users(id),
  remarks        TEXT
);

CREATE TABLE IF NOT EXISTS uniform_issues (
  id                  SERIAL PRIMARY KEY,
  candidate_id        INT NOT NULL REFERENCES candidates(id),
  item_id             INT NOT NULL REFERENCES uniform_items(id),
  size                VARCHAR(10),
  quantity            INT NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  issue_date          DATE NOT NULL,
  issued_by           INT REFERENCES users(id),
  acknowledged        BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_date   DATE,
  ack_document_id     INT REFERENCES employee_documents(id),
  remarks             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ack CHECK (NOT acknowledged OR acknowledged_date IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ui_candidate ON uniform_issues(candidate_id);

-- ================================================================== PHASE 4: documents, finance, notifications, approvals, clearance
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_documents_category_check2') THEN
    ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_category_check;
    ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_category_check2 CHECK (category IN (
      'passport','photograph','offer_letter','employment_contract','work_permit','flight_ticket','visa_medical','occupational_medical',
      'training_certificate','mohre_training','emirates_id','residence_visa','education_certificate','professional_certificate','uniform_ppe_ack','invoice','other'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mobilisation_expenses (
  id                    SERIAL PRIMARY KEY,
  candidate_id          INT NOT NULL REFERENCES candidates(id),
  category              VARCHAR(30) NOT NULL CHECK (category IN ('recruitment_fee','flight_ticket','airport_transport','visa_processing','medical_exam',
                          'emirates_id','occupational_medical','training','accommodation','uniform_ppe','other')),
  description           VARCHAR(200),
  estimated_cost        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
  actual_cost           NUMERIC(12,2) CHECK (actual_cost >= 0),
  supplier              VARCHAR(150),
  invoice_no            VARCHAR(60),
  invoice_date          DATE,
  payment_status        VARCHAR(15) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partially_paid','paid')),
  payment_date          DATE,
  invoice_document_id   INT REFERENCES employee_documents(id),
  verification_status   VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
  verified_by           INT REFERENCES users(id),
  verified_at           TIMESTAMPTZ,
  verification_remarks  TEXT,
  source                VARCHAR(30),
  source_id             INT,
  remarks               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            INT REFERENCES users(id),
  updated_at            TIMESTAMPTZ,
  updated_by            INT REFERENCES users(id),
  CONSTRAINT chk_paid_date CHECK (payment_status = 'unpaid' OR payment_date IS NOT NULL),
  CONSTRAINT chk_verified CHECK (verification_status = 'pending' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_exp_candidate ON mobilisation_expenses(candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_exp_source ON mobilisation_expenses(source, source_id) WHERE source IS NOT NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type               VARCHAR(40) NOT NULL,
  severity           VARCHAR(10) NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title              VARCHAR(200) NOT NULL,
  message            TEXT,
  link               VARCHAR(200),
  candidate_id       INT REFERENCES candidates(id) ON DELETE CASCADE,
  dedupe_key         VARCHAR(160) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_raised_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at            TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ,
  emailed_at         TIMESTAMPTZ,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS email_outbox (
  id             BIGSERIAL PRIMARY KEY,
  to_address     VARCHAR(150) NOT NULL,
  subject        VARCHAR(250) NOT NULL,
  body           TEXT NOT NULL,
  status         VARCHAR(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','held')),
  attempts       INT NOT NULL DEFAULT 0,
  last_error     TEXT,
  notification_id BIGINT REFERENCES notifications(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS approval_records (
  id              SERIAL PRIMARY KEY,
  approval_type   VARCHAR(30) NOT NULL CHECK (approval_type IN ('flight_quotation','activity_verification','expense_verification','final_clearance','deployment')),
  entity          VARCHAR(40) NOT NULL,
  entity_id       INT NOT NULL,
  candidate_id    INT REFERENCES candidates(id),
  requested_by    INT REFERENCES users(id),
  requested_at    TIMESTAMPTZ,
  decided_by      INT NOT NULL REFERENCES users(id),
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision        VARCHAR(10) NOT NULL CHECK (decision IN ('approved','rejected')),
  remarks         TEXT
);
CREATE INDEX IF NOT EXISTS idx_appr_candidate ON approval_records(candidate_id);

CREATE TABLE IF NOT EXISTS deployments (
  id                    SERIAL PRIMARY KEY,
  candidate_id          INT NOT NULL REFERENCES candidates(id),
  site                  VARCHAR(150) NOT NULL,
  supervisor_name       VARCHAR(150) NOT NULL,
  supervisor_phone      VARCHAR(30),
  planned_reporting_date DATE NOT NULL,
  status                VARCHAR(15) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','reported','cancelled')),
  requested_by          INT NOT NULL REFERENCES users(id),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by           INT REFERENCES users(id),
  approved_at           TIMESTAMPTZ,
  decision_remarks      TEXT,
  actual_reporting_date DATE,
  confirmed_by          INT REFERENCES users(id),
  confirmed_at          TIMESTAMPTZ,
  remarks               TEXT,
  CONSTRAINT chk_reported CHECK (status <> 'reported' OR (actual_reporting_date IS NOT NULL AND confirmed_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deploy_open ON deployments(candidate_id) WHERE status IN ('requested','approved','reported');
