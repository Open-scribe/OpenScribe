resource "google_artifact_registry_repository" "this" {
  location      = var.location
  repository_id = var.repository_id
  format        = "DOCKER"
  description   = "OpenScribe container images"
}
