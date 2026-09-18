export type DoctorOnboardingState = 'UNVERIFIED' | 'VERIFIED' | 'PUBLISHED';

export function doctorOnboardingState(doctor: {
  isPublished: boolean;
  licenseVerifiedAt: Date | null;
}): DoctorOnboardingState {
  if (doctor.isPublished) return 'PUBLISHED';
  return doctor.licenseVerifiedAt ? 'VERIFIED' : 'UNVERIFIED';
}

export function canPublishDoctor(doctor: {
  isPublished: boolean;
  licenseVerifiedAt: Date | null;
}): boolean {
  return doctorOnboardingState(doctor) === 'VERIFIED';
}
