import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';

export const createMaintenanceHelpers = ({
  postgresPool,
  uploadsRootDir,
}: {
  postgresPool: Pool;
  uploadsRootDir: string;
}) => {
  const getFileSizeSafe = (filePath: string) => {
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  };

  const normalizeUploadsReference = (value: unknown) => {
    const raw = String(value || '').trim();
    if (!raw || !raw.includes('/uploads/')) {
      return null;
    }

    try {
      const pathname = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
      const sanitized = pathname.split('?')[0].split('#')[0].replace(/^\/+/, '');
      const marker = 'uploads/';
      const index = sanitized.toLowerCase().indexOf(marker);
      if (index === -1) {
        return null;
      }

      return sanitized.slice(index + marker.length).replace(/\\/g, '/');
    } catch {
      return null;
    }
  };

  const collectUnusedMediaCleanupStats = async () => {
    const result = {
      scannedFiles: 0,
      deletedFiles: 0,
      deletedBytes: 0,
    };

    if (!fs.existsSync(uploadsRootDir)) {
      return result;
    }

    const referencedFiles = new Set<string>();
    const productMediaResult = await postgresPool.query(`
      SELECT thumbnail as media_path FROM products
      WHERE deleted_at IS NULL AND thumbnail IS NOT NULL AND TRIM(thumbnail) != ''
      UNION ALL
      SELECT logo as media_path FROM stores
      WHERE logo IS NOT NULL AND TRIM(logo) != ''
    `);
    const productMediaRows = productMediaResult.rows as Array<{ media_path: string | null }>;

    productMediaRows.forEach((row) => {
      const normalized = normalizeUploadsReference(row?.media_path);
      if (normalized) {
        referencedFiles.add(normalized);
      }
    });

    const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg']);
    const stack = [uploadsRootDir];

    while (stack.length > 0) {
      const currentDir = stack.pop() as string;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      entries.forEach((entry) => {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          return;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(extension)) {
          return;
        }

        result.scannedFiles += 1;
        const relativePath = path.relative(uploadsRootDir, fullPath).replace(/\\/g, '/');
        if (referencedFiles.has(relativePath)) {
          return;
        }

        const fileSize = getFileSizeSafe(fullPath);
        fs.unlinkSync(fullPath);
        result.deletedFiles += 1;
        result.deletedBytes += fileSize;
      });
    }

    return result;
  };

  const markExpiredProformas = async () => {
    try {
      const now = new Date().toISOString();
      const expiredResult = await postgresPool.query(
        `SELECT id FROM pro_formas WHERE status = 'PENDING' AND expiry_date <= $1`,
        [now],
      );
      const expiredRows = expiredResult.rows as Array<{ id: number }>;

      if (!expiredRows.length) {
        return;
      }

      await postgresPool.query(
        `UPDATE pro_formas SET status = 'EXPIRED' WHERE status = 'PENDING' AND expiry_date <= $1`,
        [now],
      );
    } catch (err) {
      console.error('Error marking expired pro-formas:', err);
    }
  };

  const startScheduledMaintenance = () => {
    setInterval(markExpiredProformas, 5 * 60 * 1000);
  };

  return {
    getFileSizeSafe,
    collectUnusedMediaCleanupStats,
    markExpiredProformas,
    startScheduledMaintenance,
  };
};
