variable "service_name" {
  type = string
}

variable "region" {
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

variable "env_vars" {
  type    = map(string)
  default = {}
}
