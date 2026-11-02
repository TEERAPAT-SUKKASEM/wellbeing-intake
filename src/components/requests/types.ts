export type StudentRequest = {
  id: string;
  serviceName: string;
  triageLevelId: number;
  status: string;
  submittedAt: string;
  bookable: boolean;
  appointment: { id: string; startAt: string | null } | null;
};

export type BookingSlot = { id: string; startAt: string };
