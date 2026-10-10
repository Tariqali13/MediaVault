-- The app connects as a NON-superuser so row-level security actually applies.
CREATE ROLE mediavault LOGIN PASSWORD 'mediavault' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE mediavault OWNER mediavault;
CREATE DATABASE mediavault_test OWNER mediavault;
