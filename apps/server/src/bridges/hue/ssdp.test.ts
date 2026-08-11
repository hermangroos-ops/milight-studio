import type { NetworkInterfaceInfo } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  SSDP_MULTICAST,
  SSDP_PORT,
  buildSearchResponse,
  deriveBridgeId,
  detectLanAddress,
  shouldRespond,
} from './ssdp.js';

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

function ipv4(address: string, options: { internal?: boolean; mac?: string } = {}): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: options.mac ?? 'aa:bb:cc:dd:ee:ff',
    internal: options.internal ?? false,
    cidr: `${address}/24`,
  };
}

function ipv6(address: string, mac = 'aa:bb:cc:dd:ee:ff'): NetworkInterfaceInfo {
  return {
    address,
    netmask: 'ffff:ffff:ffff:ffff::',
    family: 'IPv6',
    mac,
    internal: false,
    cidr: `${address}/64`,
    scopeid: 0,
  };
}

describe('constants', () => {
  it('uses the standard SSDP endpoint', () => {
    expect(SSDP_PORT).toBe(1900);
    expect(SSDP_MULTICAST).toBe('239.255.255.250');
  });
});

describe('detectLanAddress', () => {
  it('picks the first non-internal IPv4 address', () => {
    const interfaces: Interfaces = {
      lo: [ipv4('127.0.0.1', { internal: true })],
      eth0: [ipv6('fe80::1'), ipv4('192.168.1.42')],
      eth1: [ipv4('10.0.0.5')],
    };
    expect(detectLanAddress(interfaces)).toBe('192.168.1.42');
  });

  it('skips loopback and IPv6 entries', () => {
    const interfaces: Interfaces = {
      lo: [ipv4('127.0.0.1', { internal: true }), ipv6('::1')],
      eth0: [ipv6('2001:db8::1'), ipv4('172.17.0.2')],
    };
    expect(detectLanAddress(interfaces)).toBe('172.17.0.2');
  });

  it.each([
    { interfaces: {}, why: 'no interfaces at all' },
    { interfaces: { lo: [ipv4('127.0.0.1', { internal: true })] }, why: 'only loopback' },
    { interfaces: { eth0: [ipv6('2001:db8::1')] }, why: 'only IPv6' },
    { interfaces: { eth0: undefined }, why: 'an interface with no entries' },
  ])('falls back to loopback when there is $why', ({ interfaces }) => {
    expect(detectLanAddress(interfaces as Interfaces)).toBe('127.0.0.1');
  });

  it('reads the real interfaces when none are supplied', () => {
    expect(detectLanAddress()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});

describe('deriveBridgeId', () => {
  it('builds a Philips-looking id from the MAC address', () => {
    const interfaces: Interfaces = { eth0: [ipv4('192.168.1.42', { mac: 'b8:27:eb:12:34:56' })] };
    expect(deriveBridgeId(interfaces)).toBe('B827EBFFFE123456');
  });

  it('is 16 uppercase hex characters', () => {
    const id = deriveBridgeId({ eth0: [ipv4('192.168.1.42', { mac: '00:17:88:aa:bb:cc' })] });
    expect(id).toMatch(/^[0-9A-F]{16}$/);
  });

  it.each([
    { interfaces: {}, why: 'no interfaces' },
    { interfaces: { lo: [ipv4('127.0.0.1', { internal: true })] }, why: 'only loopback' },
    {
      interfaces: { eth0: [ipv4('192.168.1.42', { mac: '00:00:00:00:00:00' })] },
      why: 'an all-zero MAC address',
    },
    { interfaces: { eth0: [ipv4('192.168.1.42', { mac: '' })] }, why: 'an empty MAC address' },
    { interfaces: { eth0: undefined }, why: 'an interface with no entries' },
  ])('falls back to a fixed id when there is $why', ({ interfaces }) => {
    expect(deriveBridgeId(interfaces as Interfaces)).toBe('001788FFFE000001');
  });

  it('reads the real interfaces when none are supplied', () => {
    expect(deriveBridgeId()).toMatch(/^[0-9A-F]{16}$/);
  });
});

describe('shouldRespond', () => {
  const search = (target: string): string =>
    [
      'M-SEARCH * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'MAN: "ssdp:discover"',
      'MX: 3',
      `ST: ${target}`,
      '',
      '',
    ].join('\r\n');

  it.each([
    'ssdp:all',
    'upnp:rootdevice',
    'urn:schemas-upnp-org:device:basic:1',
    'urn:schemas-upnp-org:device:Basic:1',
    'libhue:idl',
  ])('answers a search for %s', (target) => {
    expect(shouldRespond(search(target))).toBe(true);
  });

  it('matches the search target case-insensitively', () => {
    expect(shouldRespond(search('UPNP:ROOTDEVICE'))).toBe(true);
    expect(shouldRespond(search('URN:SCHEMAS-UPNP-ORG:DEVICE:BASIC:1'))).toBe(true);
  });

  it('accepts a lowercase header name and extra whitespace', () => {
    expect(shouldRespond(search('  ssdp:all  '))).toBe(true);
    expect(shouldRespond('M-SEARCH * HTTP/1.1\r\nst:   ssdp:all   \r\n\r\n')).toBe(true);
  });

  it('accepts bare newlines as well as CRLF', () => {
    expect(shouldRespond('M-SEARCH * HTTP/1.1\nST: ssdp:all\n\n')).toBe(true);
  });

  it.each([
    { message: 'NOTIFY * HTTP/1.1\r\nST: ssdp:all\r\n\r\n', why: 'a NOTIFY rather than an M-SEARCH' },
    { message: 'HTTP/1.1 200 OK\r\nST: ssdp:all\r\n\r\n', why: 'a response rather than a request' },
    { message: '', why: 'an empty datagram' },
    { message: 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n\r\n', why: 'no ST header at all' },
    { message: search('urn:schemas-upnp-org:device:MediaServer:1'), why: 'an unrelated search target' },
    { message: search('urn:dial-multiscreen-org:service:dial:1'), why: 'a Chromecast search' },
    { message: 'this is not ssdp at all', why: 'junk' },
    { message: ' M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n', why: 'a leading space before M-SEARCH' },
  ])('ignores $why', ({ message }) => {
    expect(shouldRespond(message)).toBe(false);
  });
});

describe('buildSearchResponse', () => {
  const response = buildSearchResponse('192.168.1.42', 8080, '001788FFFE123456');

  it('starts with a 200 status line and ends with a blank line', () => {
    expect(response.startsWith('HTTP/1.1 200 OK\r\n')).toBe(true);
    expect(response.endsWith('\r\n\r\n')).toBe(true);
  });

  it('uses CRLF line endings throughout, as UPnP requires', () => {
    expect(response.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
    expect(response).not.toMatch(/[^\r]\n/);
  });

  it('points at the description document on the advertised address and port', () => {
    expect(response).toContain('LOCATION: http://192.168.1.42:8080/description.xml');
  });

  it('carries the bridge id in the hue-bridgeid header', () => {
    expect(response).toContain('hue-bridgeid: 001788FFFE123456');
  });

  it('derives a stable USN from the bridge id', () => {
    expect(response).toContain('USN: uuid:2f402f80-da50-11e1-9b23-001788fffe12');
  });

  it('advertises the search target Alexa expects', () => {
    expect(response).toContain('ST: urn:schemas-upnp-org:device:basic:1');
    expect(response).toContain('SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.48.0');
    expect(response).toContain('CACHE-CONTROL: max-age=100');
  });

  it('changes with the address, port and bridge id it is given', () => {
    const other = buildSearchResponse('10.0.0.1', 80, 'B827EBFFFE000001');
    expect(other).toContain('LOCATION: http://10.0.0.1:80/description.xml');
    expect(other).toContain('hue-bridgeid: B827EBFFFE000001');
    expect(other).not.toBe(response);
  });
});
