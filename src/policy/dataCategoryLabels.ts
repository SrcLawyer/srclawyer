import type { DataCategory } from "../engine/types.js";

export const DATA_CATEGORY_LABELS: Record<DataCategory, string> = {
  email: "Email addresses",
  name: "Names",
  phone: "Phone numbers",
  physical_address: "Physical or mailing addresses",
  payment_info: "Payment information",
  government_id: "Government-issued identifiers",
  device_id: "Device identifiers",
  ip_address: "IP addresses",
  location: "Location data",
  analytics_usage: "Usage and analytics data",
  authentication_credentials: "Authentication credentials",
  childrens_data: "Children's data",
  health_data: "Health data",
  microphone_audio: "Microphone audio",
  camera_video: "Camera video",
  generic_pii: "Other personal data",
};
