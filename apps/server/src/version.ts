/**
 * Build version. CI injects the release tag through `APP_VERSION` at image build time;
 * local runs fall back to a clearly non-release marker.
 */
export const APP_VERSION: string = process.env.APP_VERSION ?? '0.0.0-dev';
