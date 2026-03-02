variable "name" {
  type = string
}

variable "memory_size_gb" {
  type    = number
  default = 1
}

variable "region" {
  type = string
}

variable "tier" {
  type    = string
  default = "BASIC"
}

variable "authorized_network" {
  type    = string
  default = null
}
