-- Data loss: permanently deletes every stored idempotency_key and request_hash in orders.
-- Re-applying 0001 afterwards does not bring them back. The orders themselves are kept.
ALTER TABLE orders
  DROP CONSTRAINT orders_customer_idempotency_key_unique,
  DROP COLUMN request_hash,
  DROP COLUMN idempotency_key;
