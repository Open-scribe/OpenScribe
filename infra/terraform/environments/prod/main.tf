provider "google" {
  project = var.project_id
  region  = var.region
}

module "artifact_registry" {
  source        = "../../modules/artifact-registry"
  location      = var.region
  repository_id = var.artifact_repository_id
}

module "secret_anthropic" {
  source    = "../../modules/secret-manager"
  secret_id = var.anthropic_secret_id
}

module "firestore" {
  source          = "../../modules/firestore"
  project_id      = var.project_id
  location_id     = var.firestore_location
  create_database = var.create_firestore_database
}

module "redis" {
  source             = "../../modules/redis"
  name               = var.redis_name
  memory_size_gb     = var.redis_memory_size_gb
  region             = var.region
  tier               = var.redis_tier
  authorized_network = var.redis_authorized_network
}

module "cloud_run" {
  source                = "../../modules/cloud-run"
  service_name          = var.service_name
  region                = var.region
  service_account       = var.service_account
  image                 = var.image
  allow_unauthenticated = var.allow_unauthenticated
  env_vars              = var.env_vars
}
