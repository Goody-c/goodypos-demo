import { getLicenseDeviceInfo } from './serverRuntimeEnvironment';

const normalizeLicenseServiceBaseUrl = (value: unknown) => String(value || '').trim().replace(/\/+$/, '');
const LICENSE_ACTIVATION_TIMEOUT_MS = 15000;
const LICENSE_HEALTH_TIMEOUT_MS = 12000;
const LICENSE_HEALTH_RETRY_DELAY_MS = 2000;

const normalizeLicenseServiceErrorMessage = (message: unknown) => {
  const normalized = String(message || '').trim();

  if (!normalized) {
    return 'License activation failed';
  }

  if (/DEPLOYMENT_NOT_FOUND|deployment could not be found on vercel/i.test(normalized)) {
    return 'The configured license server deployment was not found on Vercel. Update GOODY_POS_LICENSE_API_URL or redeploy the licensing service.';
  }

  if (/already linked to another license|already bound to another device/i.test(normalized)) {
    return normalized;
  }

  if (/failed to activate license/i.test(normalized)) {
    return 'License activation could not be completed right now. Please confirm the key is genuine and try again.';
  }

  return normalized;
};

const getResponseMessage = (payload: unknown, fallback: string) => {
  if (typeof payload === 'object' && payload !== null) {
    return String((payload as any)?.error || (payload as any)?.message || fallback);
  }

  return String(payload || fallback);
};

export const createLicenseService = ({
  dataRootDir,
  appVersion,
}: {
  dataRootDir: string;
  appVersion: string;
}) => {
  const LICENSE_API_BASE_URL = normalizeLicenseServiceBaseUrl(process.env.GOODY_POS_LICENSE_API_URL);
  const licenseRestrictionFlag = String(process.env.GOODY_POS_LICENSE_REQUIRED_FOR_NEW_STORES || '').trim().toLowerCase();
  const LICENSE_REQUIRED_FOR_NEW_STORES = LICENSE_API_BASE_URL
    ? ['1', 'true', 'yes', 'on'].includes(licenseRestrictionFlag)
    : false;

  const {
    deviceFingerprint: LICENSE_DEVICE_FINGERPRINT,
    deviceName: LICENSE_DEVICE_NAME,
  } = getLicenseDeviceInfo(dataRootDir);

  const attemptLicenseHealthCheck = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LICENSE_HEALTH_TIMEOUT_MS);

    try {
      const response = await fetch(`${LICENSE_API_BASE_URL}/api/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      const contentType = String(response.headers.get('content-type') || '');
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        return {
          ok: false,
          statusCode: response.status,
          error: normalizeLicenseServiceErrorMessage(getResponseMessage(payload, 'License service is unavailable right now.')),
        };
      }

      const payloadOk = typeof payload === 'object' && payload !== null
        ? Boolean((payload as any)?.ok ?? true)
        : true;

      return {
        ok: payloadOk,
        statusCode: response.status,
        error: payloadOk
          ? null
          : normalizeLicenseServiceErrorMessage(getResponseMessage(payload, 'License service is unavailable right now.')),
      };
    } catch (error: any) {
      return {
        ok: false,
        statusCode: null,
        error: error?.name === 'AbortError' ? 'timeout' : (error?.message || 'network error'),
        isTransient: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  const checkLicenseServiceConnection = async () => {
    if (!LICENSE_API_BASE_URL) {
      return {
        configured: false,
        connected: false,
        statusCode: null,
        error: 'License service URL is not configured yet.',
      };
    }

    // First attempt
    let result = await attemptLicenseHealthCheck();

    // If timed out or transient network error, wait briefly and retry once.
    // This handles Vercel cold-start delays on the license service.
    if (!result.ok && (result as any).isTransient) {
      await new Promise((resolve) => setTimeout(resolve, LICENSE_HEALTH_RETRY_DELAY_MS));
      result = await attemptLicenseHealthCheck();
    }

    if (result.ok) {
      return {
        configured: true,
        connected: true,
        statusCode: result.statusCode,
        error: null,
      };
    }

    const userFacingError = result.error === 'timeout'
      ? 'Could not reach the configured license server in time. Check the deployment URL and internet connection.'
      : normalizeLicenseServiceErrorMessage(result.error || 'Could not reach the configured license server.');

    return {
      configured: true,
      connected: false,
      statusCode: result.statusCode,
      error: userFacingError,
    };
  };

  const activateRemoteStoreLicense = async ({
    licenseKey,
    storeName,
    storeMode,
  }: {
    licenseKey: string;
    storeName: string;
    storeMode: 'SUPERMARKET' | 'GADGET';
  }) => {
    if (!LICENSE_API_BASE_URL) {
      throw new Error('License service is not configured for this GoodyPOS deployment yet.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LICENSE_ACTIVATION_TIMEOUT_MS);

    try {
      const response = await fetch(`${LICENSE_API_BASE_URL}/api/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          licenseKey,
          deviceFingerprint: LICENSE_DEVICE_FINGERPRINT,
          deviceName: LICENSE_DEVICE_NAME,
          storeName,
          storeMode,
          appVersion,
        }),
      });

      const contentType = String(response.headers.get('content-type') || '');
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const message = normalizeLicenseServiceErrorMessage(
          getResponseMessage(payload, 'License activation failed'),
        );

        throw new Error(message);
      }

      return payload as any;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('Could not reach the license server in time. Internet is required for first activation.');
      }

      const message = normalizeLicenseServiceErrorMessage(error?.message || 'License activation failed');
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    LICENSE_API_BASE_URL,
    LICENSE_REQUIRED_FOR_NEW_STORES,
    LICENSE_DEVICE_NAME,
    checkLicenseServiceConnection,
    activateRemoteStoreLicense,
  };
};
