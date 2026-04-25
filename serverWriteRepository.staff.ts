import type { Pool } from 'pg';

type CreateHandoverNoteInput = {
  storeId: number;
  authorId: number;
  noteText: string;
  priority: string;
  isPinned: boolean;
};

type UpdateHandoverNotePinInput = {
  storeId: number;
  noteId: number;
  isPinned: boolean;
};

type DeleteHandoverNoteInput = {
  noteId: number;
  storeId: number;
};

type CreateAttendanceClockInInput = {
  storeId: number;
  userId: number;
  note?: string | null;
  shiftDate: string;
};

type ClockOutAttendanceInput = {
  storeId: number;
  userId: number;
  note?: string | null;
  totalMinutes: number;
};

type CreateInternalMessageInput = {
  storeId: number;
  senderId: number;
  recipientId: number;
  messageText: string;
};

type MarkInternalMessagesReadInput = {
  storeId: number;
  senderId: number;
  recipientId: number;
};

type DeleteInternalMessagesInput = {
  storeId: number;
  messageIds: number[];
};

type CleanupInternalMessagesInput = {
  storeId: number;
  olderThanValue: number;
  olderThanUnit: string;
};

const toUniquePositiveIds = (values: unknown[]) => Array.from(new Set(
  values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0),
));

export const createStaffWriteRepository = ({ postgresPool }: { postgresPool: Pool }) => ({
  async createHandoverNote(input: CreateHandoverNoteInput) {
    const result = await postgresPool.query(`
      INSERT INTO handover_notes (store_id, author_id, note_text, priority, is_pinned, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING id
    `, [input.storeId, input.authorId, input.noteText, input.priority, input.isPinned ? 1 : 0]);

    const noteId = Number(result.rows[0]?.id || 0);
    const noteResult = await postgresPool.query(`
      SELECT n.*, u.username as author_username, u.role as author_role
      FROM handover_notes n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.id = $1 AND n.store_id = $2
      LIMIT 1
    `, [noteId, input.storeId]);
    return noteResult.rows[0] || null;
  },

  async updateHandoverNotePin(input: UpdateHandoverNotePinInput) {
    const result = await postgresPool.query(`
      UPDATE handover_notes
      SET is_pinned = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND store_id = $3
      RETURNING id
    `, [input.isPinned ? 1 : 0, input.noteId, input.storeId]);
    if (!result.rows[0]) return null;

    const noteResult = await postgresPool.query(`
      SELECT n.*, u.username as author_username, u.role as author_role
      FROM handover_notes n
      LEFT JOIN users u ON n.author_id = u.id
      WHERE n.id = $1 AND n.store_id = $2
      LIMIT 1
    `, [input.noteId, input.storeId]);
    return noteResult.rows[0] || null;
  },

  async deleteHandoverNote(input: DeleteHandoverNoteInput) {
    await postgresPool.query('DELETE FROM handover_notes WHERE id = $1 AND store_id = $2', [input.noteId, input.storeId]);
    return input.noteId;
  },

  async createAttendanceClockIn(input: CreateAttendanceClockInInput) {
    const openCheck = await postgresPool.query(`
      SELECT id FROM staff_attendance
      WHERE store_id = $1 AND user_id = $2 AND clock_out_at IS NULL
      LIMIT 1
    `, [input.storeId, input.userId]);
    const existingOpenSession = openCheck.rows[0] || null;

    if (existingOpenSession) {
      return { existingOpenSession, entry: null };
    }

    const insertResult = await postgresPool.query(`
      INSERT INTO staff_attendance (store_id, user_id, shift_date, clock_in_at, note)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
      RETURNING id
    `, [input.storeId, input.userId, input.shiftDate, input.note || null]);

    const attendanceId = Number(insertResult.rows[0]?.id || 0);
    const entryResult = await postgresPool.query(`
      SELECT sa.*, u.username as user_name, u.role
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.id = $1 AND sa.store_id = $2
      LIMIT 1
    `, [attendanceId, input.storeId]);
    const entry = entryResult.rows[0] || null;

    return { existingOpenSession: null, entry };
  },

  async clockOutAttendance(input: ClockOutAttendanceInput) {
    const openSessionResult = await postgresPool.query(`
      SELECT sa.*, u.username as user_name, u.role
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.store_id = $1 AND sa.user_id = $2 AND sa.clock_out_at IS NULL
      ORDER BY sa.clock_in_at DESC, sa.id DESC
      LIMIT 1
    `, [input.storeId, input.userId]);
    const openSession = openSessionResult.rows[0] || null;

    if (!openSession) {
      return { openSession: null, entry: null };
    }

    await postgresPool.query(`
      UPDATE staff_attendance
      SET clock_out_at = CURRENT_TIMESTAMP, total_minutes = $1, note = $2
      WHERE id = $3 AND store_id = $4
    `, [input.totalMinutes, input.note || null, openSession.id, input.storeId]);

    const entryResult = await postgresPool.query(`
      SELECT sa.*, u.username as user_name, u.role
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      WHERE sa.id = $1 AND sa.store_id = $2
      LIMIT 1
    `, [openSession.id, input.storeId]);
    const entry = entryResult.rows[0] || null;

    return { openSession, entry };
  },

  async clearAttendanceHistory(storeId: number, scope: 'day' | 'month' | 'year', date: string) {
    let result;
    if (scope === 'day') {
      result = await postgresPool.query(
        'DELETE FROM staff_attendance WHERE store_id = $1 AND shift_date = $2',
        [storeId, date],
      );
    } else if (scope === 'month') {
      // Match dates like 2026-04-* for month 2026-04
      result = await postgresPool.query(
        "DELETE FROM staff_attendance WHERE store_id = $1 AND shift_date LIKE $2",
        [storeId, `${date}%`],
      );
    } else {
      // Match dates like 2026-* for year 2026
      result = await postgresPool.query(
        "DELETE FROM staff_attendance WHERE store_id = $1 AND shift_date LIKE $2",
        [storeId, `${date}%`],
      );
    }
    return Number(result.rowCount || 0);
  },

  async createInternalMessage(input: CreateInternalMessageInput) {
    const result = await postgresPool.query(`
      INSERT INTO internal_messages (store_id, sender_id, recipient_id, message_text, is_read)
      VALUES ($1, $2, $3, $4, 0)
      RETURNING id
    `, [input.storeId, input.senderId, input.recipientId, input.messageText]);

    const messageId = Number(result.rows[0]?.id || 0);
    const msgResult = await postgresPool.query(`
      SELECT m.*, sender.username as sender_username, sender.role as sender_role,
             recipient.username as recipient_username, recipient.role as recipient_role
      FROM internal_messages m
      LEFT JOIN users sender ON m.sender_id = sender.id
      LEFT JOIN users recipient ON m.recipient_id = recipient.id
      WHERE m.id = $1 AND m.store_id = $2
      LIMIT 1
    `, [messageId, input.storeId]);
    return msgResult.rows[0] || null;
  },

  async markInternalMessagesRead(input: MarkInternalMessagesReadInput) {
    const unreadRows = await postgresPool.query(`
      SELECT id FROM internal_messages
      WHERE store_id = $1 AND sender_id = $2 AND recipient_id = $3 AND is_read = 0
    `, [input.storeId, input.senderId, input.recipientId]);
    const unreadMessageIds = unreadRows.rows.map((row: any) => Number(row.id)).filter((id: number) => id > 0);

    await postgresPool.query(`
      UPDATE internal_messages
      SET is_read = 1
      WHERE store_id = $1 AND sender_id = $2 AND recipient_id = $3 AND is_read = 0
    `, [input.storeId, input.senderId, input.recipientId]);

    return unreadMessageIds;
  },

  async deleteInternalMessages(input: DeleteInternalMessagesInput) {
    const messageIds = toUniquePositiveIds(input.messageIds || []);
    if (!messageIds.length) {
      return 0;
    }
    const placeholders = messageIds.map((_, index) => `${index + 2}`).join(', ');
    await postgresPool.query(
      `DELETE FROM internal_messages WHERE store_id = $1 AND id IN (${placeholders})`,
      [input.storeId, ...messageIds],
    );
    return messageIds.length;
  },

  async cleanupInternalMessages(input: CleanupInternalMessagesInput) {
    const cutoffTs = new Date(Date.now() - input.olderThanValue * (
      input.olderThanUnit === 'day' ? 86400000 :
      input.olderThanUnit === 'week' ? 604800000 :
      input.olderThanUnit === 'month' ? 2592000000 : 86400000
    )).toISOString();

    const toDeleteResult = await postgresPool.query(
      'SELECT id FROM internal_messages WHERE store_id = $1 AND created_at < $2',
      [input.storeId, cutoffTs],
    );
    const messagesToDelete = toDeleteResult.rows.map((row: any) => Number(row.id));

    const deleteResult = await postgresPool.query(
      'DELETE FROM internal_messages WHERE store_id = $1 AND created_at < $2',
      [input.storeId, cutoffTs],
    );

    const storeResult = await postgresPool.query(`
      UPDATE stores
      SET last_chat_cleanup_at = CURRENT_TIMESTAMP,
          chat_retention_value = $1,
          chat_retention_unit = $2
      WHERE id = $3
      RETURNING *
    `, [input.olderThanValue, input.olderThanUnit, input.storeId]);

    return {
      deletedCount: Number(deleteResult.rowCount || 0),
      wouldDeleteCount: messagesToDelete.length,
      store: storeResult.rows[0] || null,
    };
  },
});
