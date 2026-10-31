import { connectDB } from '@/lib/db'
import { Notification } from '@/models/notification'
import type { Session } from '@/lib/auth'

export async function unreadNotificationCount(
  session: Session,
): Promise<number> {
  await connectDB()
  return Notification.countDocuments({
    organizationId: session.organizationId,
    userId: session.userId,
    readAt: null,
  })
}
