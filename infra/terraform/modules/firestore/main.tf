resource "google_firestore_database" "this" {
  count       = var.create_database ? 1 : 0
  project     = var.project_id
  name        = "(default)"
  location_id = var.location_id
  type        = "FIRESTORE_NATIVE"
}
