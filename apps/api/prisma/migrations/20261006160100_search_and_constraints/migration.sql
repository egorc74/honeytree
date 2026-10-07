-- Hand-written migration: things Prisma cannot express.

-- Typo-tolerant search (trigram similarity)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Full-text search vector for games. 'simple' config on purpose: games come in any language,
-- so no stemming/stop-words; prefix matching is done at query time with `:*`.
CREATE OR REPLACE FUNCTION games_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.short_description, '') || ' ' || coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER games_search_vector_trg
  BEFORE INSERT OR UPDATE OF title, tags, short_description, description ON games
  FOR EACH ROW EXECUTE FUNCTION games_search_vector_update();

CREATE INDEX games_search_vector_idx ON games USING GIN (search_vector);
CREATE INDEX games_title_trgm_idx ON games USING GIN (title gin_trgm_ops);
CREATE INDEX users_username_trgm_idx ON users USING GIN (username gin_trgm_ops);
CREATE INDEX users_display_name_trgm_idx ON users USING GIN (display_name gin_trgm_ops);

-- Data integrity backstops (the API validates too)
ALTER TABLE reviews ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE karma_events ADD CONSTRAINT karma_events_amount_nonzero CHECK (amount <> 0);
