import type { Express } from 'express';
import type { Pool } from 'pg';

type StaffCommunicationRouteDependencies = {
  app: Express;
  postgresPool: Pool;
  authenticate: any;
  authorize: (roles: string[]) => any;
  checkStoreLock: any;
  coreReadRepository: any;
  coreWriteRepository: any;
  clampChatRetentionValue: (value: unknown) => number;
  normalizeChatRetentionUnit: (value: unknown) => 'days' | 'months';
  isChatCleanupReminderDue: (store: any, referenceDate?: Date) => boolean;
  formatHandoverNoteRecord: (note: any, currentUser?: any) => any;
  normalizeHandoverPriority: (value: unknown) => string;
  formatAttendanceEntry: (entry: any) => any;
  getShiftDateKey: (dateInput?: Date) => string;
  getAttendanceDurationMinutes: (clockInAt: string, clockOutAt: string) => number;
};

export const registerStaffCommunicationRoutes = ({
  app,
  postgresPool,
  authenticate,
  authorize,
  checkStoreLock,
  coreReadRepository,
  coreWriteRepository,
  clampChatRetentionValue,
  normalizeChatRetentionUnit,
  isChatCleanupReminderDue,
  formatHandoverNoteRecord,
  normalizeHandoverPriority,
  formatAttendanceEntry,
  getShiftDateKey,
  getAttendanceDurationMinutes,
}: StaffCommunicationRouteDependencies) => {
  const teamRoles = ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF'];

  app.get('/api/internal-messages/contacts', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const currentUserId = Number(req.user.id);

    try {
      const contacts = await coreReadRepository.listInternalMessageContacts(storeId, currentUserId);
      res.json({ contacts });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load chat contacts' });
    }
  });

  app.get('/api/internal-messages', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const currentUserId = Number(req.user.id);
    const withUserId = Number(req.query.with_user_id || req.query.recipient_id || 0);

    if (!Number.isInteger(withUserId) || withUserId <= 0) {
      return res.status(400).json({ error: 'Select a valid team member to open the conversation' });
    }

    try {
      const { contact, unreadMessageIds, messages } = await coreReadRepository.getInternalConversation(storeId, currentUserId, withUserId);

      if (!contact) {
        return res.status(404).json({ error: 'Team member not found for this store' });
      }

      if (unreadMessageIds.length) {
        await coreWriteRepository.markInternalMessagesRead({
          storeId,
          senderId: withUserId,
          recipientId: currentUserId,
        });
      }

      res.json({
        contact,
        messages: messages.map((message: any) => ({
          ...message,
          is_read: Number(message?.is_read || 0) === 1,
          message_text: String(message?.message_text || ''),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load chat messages' });
    }
  });

  app.post('/api/internal-messages', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const senderId = Number(req.user.id);
    const recipientId = Number(req.body?.recipient_id || 0);
    const rawMessage = String(req.body?.message || req.body?.message_text || '');
    const messageText = rawMessage.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!Number.isInteger(recipientId) || recipientId <= 0) {
      return res.status(400).json({ error: 'Choose a valid team member to receive this message' });
    }
    if (recipientId === senderId) {
      return res.status(400).json({ error: 'You cannot message yourself here' });
    }
    if (!messageText) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    if (messageText.length > 4000) {
      return res.status(400).json({ error: 'Message is too long. Keep it under 4000 characters.' });
    }

    try {
      const contacts = await coreReadRepository.listInternalMessageContacts(storeId, senderId);
      const recipient = contacts.find((contact: any) => Number(contact.id) === recipientId);

      if (!recipient) {
        return res.status(404).json({ error: 'Selected team member was not found in this store' });
      }

      const createdMessage = await coreWriteRepository.createInternalMessage({
        storeId,
        senderId,
        recipientId,
        messageText,
      });

      res.json({
        success: true,
        message: {
          ...createdMessage,
          is_read: Number(createdMessage?.is_read || 0) === 1,
          message_text: String(createdMessage?.message_text || ''),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to send internal message' });
    }
  });

  app.post('/api/internal-messages/cleanup', authenticate, authorize(['STORE_ADMIN']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const olderThanValue = clampChatRetentionValue(req.body?.older_than_value ?? req.body?.retention_value);
    const olderThanUnit = normalizeChatRetentionUnit(req.body?.older_than_unit ?? req.body?.retention_unit);
    const isDryRun = req.body?.dry_run === true || req.body?.dryRun === true;

    try {
      if (isDryRun) {
        const cutoffInterval = `${olderThanValue} ${olderThanUnit}`;
        const dryRunResult = await postgresPool.query(
          `SELECT id FROM internal_messages WHERE store_id = $1 AND created_at < NOW() - CAST($2 AS INTERVAL)`,
          [storeId, cutoffInterval],
        );
        const store = await coreReadRepository.getStoreById(storeId);

        return res.json({
          success: true,
          dryRun: true,
          deletedCount: 0,
          wouldDeleteCount: dryRunResult.rows.length,
          olderThanValue,
          olderThanUnit,
          last_chat_cleanup_at: store?.last_chat_cleanup_at || null,
          reminderDue: isChatCleanupReminderDue(store),
        });
      }

      const result = await coreWriteRepository.cleanupInternalMessages({
        storeId,
        olderThanValue,
        olderThanUnit,
      });

      res.json({
        success: true,
        dryRun: false,
        deletedCount: result.deletedCount,
        wouldDeleteCount: result.wouldDeleteCount,
        olderThanValue,
        olderThanUnit,
        last_chat_cleanup_at: result.store?.last_chat_cleanup_at || new Date().toISOString(),
        reminderDue: isChatCleanupReminderDue(result.store),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to clear old internal chat history' });
    }
  });

  app.get('/api/handover-notes', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));

    try {
      const notes = await coreReadRepository.listHandoverNotes(storeId, limit);

      res.json({
        notes: notes.map((note: any) => formatHandoverNoteRecord(note, req.user)),
        limit,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load handover notes' });
    }
  });

  app.post('/api/handover-notes', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const authorId = Number(req.user.id);
    const noteText = String(req.body?.note ?? req.body?.note_text ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const priority = normalizeHandoverPriority(req.body?.priority);
    const canPin = ['STORE_ADMIN', 'MANAGER'].includes(String(req.user.role || ''));
    const isPinned = canPin && (req.body?.is_pinned === true || req.body?.is_pinned === 1 || req.body?.isPinned === true);

    if (!noteText) {
      return res.status(400).json({ error: 'Add a short handover note before saving' });
    }
    if (noteText.length > 600) {
      return res.status(400).json({ error: 'Keep handover notes under 600 characters' });
    }

    try {
      const createdNote = await coreWriteRepository.createHandoverNote({
        storeId,
        authorId,
        noteText,
        priority,
        isPinned,
      });

      res.json({
        success: true,
        note: formatHandoverNoteRecord(createdNote, req.user),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to save handover note' });
    }
  });

  app.put('/api/handover-notes/:id/pin', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const noteId = Number(req.params.id);

    if (!Number.isInteger(noteId) || noteId <= 0) {
      return res.status(400).json({ error: 'Invalid handover note id' });
    }

    try {
      const updatedNote = await coreWriteRepository.updateHandoverNotePin({
        storeId,
        noteId,
        isPinned: req.body?.is_pinned === true || req.body?.is_pinned === 1 || req.body?.isPinned === true,
      });

      if (!updatedNote) {
        return res.status(404).json({ error: 'Handover note not found' });
      }

      res.json({
        success: true,
        note: formatHandoverNoteRecord(updatedNote, req.user),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to update handover note' });
    }
  });

  app.delete('/api/handover-notes/:id', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const noteId = Number(req.params.id);

    if (!Number.isInteger(noteId) || noteId <= 0) {
      return res.status(400).json({ error: 'Invalid handover note id' });
    }

    try {
      const noteResult = await postgresPool.query(
        'SELECT * FROM handover_notes WHERE id = $1 AND store_id = $2 LIMIT 1',
        [noteId, storeId],
      );
      const note = noteResult.rows[0] as any;
      if (!note) {
        return res.status(404).json({ error: 'Handover note not found' });
      }

      const canDelete = Number(note.author_id) === Number(req.user.id)
        || ['STORE_ADMIN', 'MANAGER'].includes(String(req.user.role || ''));

      if (!canDelete) {
        return res.status(403).json({ error: 'You can only delete your own handover notes' });
      }

      await coreWriteRepository.deleteHandoverNote({ noteId, storeId });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to delete handover note' });
    }
  });

  app.get('/api/attendance', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const currentUserId = Number(req.user.id);
    const selectedDate = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? String(req.query.date)
      : getShiftDateKey();
    const isLeadership = ['STORE_ADMIN', 'MANAGER'].includes(String(req.user.role || ''));

    try {
      const { currentSession, myEntries, teamEntries } = await coreReadRepository.getAttendanceOverview(storeId, currentUserId, selectedDate, isLeadership);
      const formattedTeamEntries = teamEntries.map((entry: any) => formatAttendanceEntry(entry));

      res.json({
        selected_date: selectedDate,
        current_session: currentSession ? formatAttendanceEntry(currentSession) : null,
        my_entries: myEntries.map((entry: any) => formatAttendanceEntry(entry)),
        team_entries: formattedTeamEntries,
        summary: {
          present_count: new Set(formattedTeamEntries.map((entry: any) => Number(entry.user_id))).size,
          open_count: formattedTeamEntries.filter((entry: any) => entry.is_open).length,
          clocked_out_count: formattedTeamEntries.filter((entry: any) => !entry.is_open).length,
          total_hours: Number(formattedTeamEntries.reduce((sum: number, entry: any) => sum + (Number(entry.total_hours || 0) || 0), 0).toFixed(2)),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load attendance data' });
    }
  });

  app.post('/api/attendance/clock-in', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const userId = Number(req.user.id);
    const note = String(req.body?.note || '').trim().slice(0, 240) || null;

    try {
      const result = await coreWriteRepository.createAttendanceClockIn({
        storeId,
        userId,
        note,
        shiftDate: getShiftDateKey(),
      });

      if (result.existingOpenSession) {
        return res.status(400).json({ error: 'You already have an active shift. Please clock out first.' });
      }

      res.json({ success: true, entry: formatAttendanceEntry(result.entry) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to clock in' });
    }
  });

  app.post('/api/attendance/clock-out', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const userId = Number(req.user.id);
    const note = String(req.body?.note || '').trim().slice(0, 240);

    try {
      const attendanceState = await coreReadRepository.getAttendanceOverview(storeId, userId, getShiftDateKey(), false);
      const openSession = attendanceState.currentSession;

      if (!openSession) {
        return res.status(400).json({ error: 'There is no active shift to clock out from.' });
      }

      const totalMinutes = getAttendanceDurationMinutes(openSession.clock_in_at, new Date().toISOString());
      const mergedNote = [String(openSession.note || '').trim(), note].filter(Boolean).join(' • ').slice(0, 240) || null;
      const result = await coreWriteRepository.clockOutAttendance({
        storeId,
        userId,
        note: mergedNote,
        totalMinutes,
      });

      if (!result.entry) {
        return res.status(400).json({ error: 'There is no active shift to clock out from.' });
      }

      res.json({ success: true, entry: formatAttendanceEntry(result.entry) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to clock out' });
    }
  });

  app.get('/api/attendance/history', authenticate, authorize(teamRoles), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const userId = Number(req.user.id);
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '8'), 10)));

    try {
      const result = await coreReadRepository.getAttendanceHistory(storeId, userId, page, limit);
      res.json({
        entries: result.rows.map((entry: any) => formatAttendanceEntry(entry)),
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load attendance history' });
    }
  });

  app.delete('/api/attendance/clear', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const scope = String(req.body?.scope || '');
    const date = String(req.body?.date || '').trim();

    if (!['day', 'month', 'year'].includes(scope)) {
      return res.status(400).json({ error: 'Invalid scope. Must be day, month, or year.' });
    }
    if (scope === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD for day scope.' });
    }
    if (scope === 'month' && !/^\d{4}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date. Use YYYY-MM for month scope.' });
    }
    if (scope === 'year' && !/^\d{4}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date. Use YYYY for year scope.' });
    }

    try {
      const deleted = await coreWriteRepository.clearAttendanceHistory(storeId, scope as 'day' | 'month' | 'year', date);
      res.json({ success: true, deleted });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to clear attendance history' });
    }
  });
};
