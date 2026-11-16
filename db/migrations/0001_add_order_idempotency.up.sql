-- Data loss: none. Adds two nullable columns and a unique constraint to orders; existing rows
-- get NULL keys, which the constraint allows any number of.
ALTER TABLE orders
  ADD COLUMN idempotency_key VARCHAR(255) NULL,
  ADD COLUMN request_hash TEXT NULL,
  ADD CONSTRAINT orders_customer_idempotency_key_unique UNIQUE (customer_id, idempotency_key);
