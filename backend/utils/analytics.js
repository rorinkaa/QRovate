import geoip from 'geoip-lite';
import useragent from 'useragent';

/**
 * Extract device information from user agent string
 */
export function extractDeviceInfo(userAgent) {
  const agent = useragent.parse(userAgent);
  return {
    device: agent.device.family || 'Unknown',
    os: agent.os.family || 'Unknown',
    browser: agent.toAgent(),
    isMobile: agent.device.family !== 'Other'
  };
}

/**
 * Extract geographic information from IP address
 */
export function extractGeoInfo(ip) {
  // Skip localhost/private IPs
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return { country: 'Unknown', city: 'Unknown', region: 'Unknown' };
  }
  
  if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return { country: 'Unknown', city: 'Unknown', region: 'Unknown' };
  }
  
  const geo = geoip.lookup(ip);
  return {
    country: geo?.country || 'Unknown',
    city: geo?.city || 'Unknown',
    region: geo?.region || 'Unknown',
    timezone: geo?.timezone || 'Unknown'
  };
}

/**
 * Extract comprehensive analytics data from request
 */
export function extractAnalyticsData(req) {
  const userAgent = req.headers['user-agent'] || '';
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  
  return {
    timestamp: Date.now(),
    ip,
    userAgent,
    referer: req.headers.referer || null,
    ...extractDeviceInfo(userAgent),
    ...extractGeoInfo(ip)
  };
}

/**
 * Check if a QR code is expired
 */
export function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return Date.now() > expiresAt.getTime();
}

/**
 * Check if a QR code is within scheduled time window
 */
export function isWithinSchedule(startDate, endDate) {
  const now = Date.now();
  if (startDate && now < startDate.getTime()) return false;
  if (endDate && now > endDate.getTime()) return false;
  return true;
}

/**
 * Get the appropriate target URL based on schedule and expiration
 */
export function getTargetUrl(qr) {
  const now = Date.now();
  
  // Check expiration
  if (qr.expiresAt && now > qr.expiresAt.getTime()) {
    return qr.alternateTarget || null;
  }
  
  // Check schedule
  if (qr.scheduledStart && now < qr.scheduledStart.getTime()) {
    return qr.alternateTarget || null;
  }
  
  if (qr.scheduledEnd && now > qr.scheduledEnd.getTime()) {
    return qr.alternateTarget || null;
  }
  
  return qr.target;
}

/**
 * Aggregate events into analytics summary
 */
export function aggregateAnalytics(events) {
  const analytics = {
    devices: {},
    countries: {},
    browsers: {},
    os: {},
    referers: {},
    totalScans: events.length,
    hourlyDistribution: {}
  };

  events.forEach(event => {
    const data = event.data || {};
    
    // Aggregate devices
    if (data.device) {
      analytics.devices[data.device] = (analytics.devices[data.device] || 0) + 1;
    }
    
    // Aggregate countries
    if (data.country) {
      analytics.countries[data.country] = (analytics.countries[data.country] || 0) + 1;
    }
    
    // Aggregate browsers
    if (data.browser) {
      analytics.browsers[data.browser] = (analytics.browsers[data.browser] || 0) + 1;
    }
    
    // Aggregate OS
    if (data.os) {
      analytics.os[data.os] = (analytics.os[data.os] || 0) + 1;
    }
    
    // Aggregate referers
    if (data.referer) {
      try {
        const url = new URL(data.referer);
        const domain = url.hostname;
        analytics.referers[domain] = (analytics.referers[domain] || 0) + 1;
      } catch {
        // Invalid URL, skip
      }
    }
    
    // Hourly distribution
    const hour = new Date(event.timestamp).getHours();
    analytics.hourlyDistribution[hour] = (analytics.hourlyDistribution[hour] || 0) + 1;
  });

  return analytics;
}


