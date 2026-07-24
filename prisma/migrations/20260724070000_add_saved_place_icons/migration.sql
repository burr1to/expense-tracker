ALTER TABLE "SavedPlace"
  ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'pin';

ALTER TABLE "SavedPlace"
  ADD CONSTRAINT "SavedPlace_icon_check"
  CHECK ("icon" IN ('pin', 'home', 'work', 'food', 'shopping', 'health', 'favorite'));
