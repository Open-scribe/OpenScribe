output "secret_name" {
  value = google_secret_manager_secret.this.secret_id
}
