resource "google_redis_instance" "this" {
  name               = var.name
  memory_size_gb     = var.memory_size_gb
  region             = var.region
  tier               = var.tier
  authorized_network = var.authorized_network
  redis_version      = "REDIS_7_0"
}
