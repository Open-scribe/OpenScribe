variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "artifact_repository_id" {
  type = string
}

variable "service_name" {
  type = string
}

variable "service_account" {
  type = string
}

variable "image" {
  type = string
}

variable "allow_unauthenticated" {
  type    = bool
  default = false
}

variable "firestore_location" {
  type    = string
  default = "nam5"
}

variable "create_firestore_database" {
  type    = bool
  default = false
}

variable "redis_name" {
  type = string
}

variable "redis_memory_size_gb" {
  type    = number
  default = 1
}

variable "redis_tier" {
  type    = string
  default = "BASIC"
}

variable "redis_authorized_network" {
  type    = string
  default = null
}

variable "anthropic_secret_id" {
  type = string
}

variable "env_vars" {
  type    = map(string)
  default = {}
}
