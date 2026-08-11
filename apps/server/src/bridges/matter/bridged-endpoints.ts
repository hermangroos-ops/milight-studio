/**
 * Everything that actually touches `@matter/main`: the cluster behaviours that turn
 * Matter commands into hub calls, and the factory that adds a bridged endpoint of the
 * right device type to the aggregator.
 */

import type { EndpointType, MaybePromise } from '@matter/main';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors';
import { xyToHsv } from '@matter/main/behaviors/color-control';
import type { ColorControl, LevelControl } from '@matter/main/clusters';
import {
  ColorTemperatureLightDevice,
  ColorTemperatureLightRequirements,
  DimmableLightDevice,
  DimmableLightRequirements,
  ExtendedColorLightDevice,
  ExtendedColorLightRequirements,
  OnOffLightDevice,
  OnOffLightRequirements,
} from '@matter/main/devices';
import type { TypeFromPartialBitSchema } from '@matter/main/types';
import { MAX_MIRED, MIN_MIRED } from '@milight-studio/shared';

import {
  COLOR_MODE_COLOR_TEMPERATURE,
  enhancedHueToMatterHue,
  matterXyToUnit,
  type MatterLightAttributes,
} from './attribute-mapping.js';
import type { BridgedTarget, MatterCommandRouter } from './command-router.js';
import { kindHasColorControl, kindHasHueSaturation, kindHasLevelControl } from './device-mapping.js';

/** The slice of `Endpoint` the rest of the bridge needs; keeps generics out of maps. */
export interface BridgedEndpointHandle {
  readonly id: string;
  setStateOf(type: string, values: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}

/** The aggregator, reduced to the one call we make on it. */
export interface AggregatorHandle {
  add(type: EndpointType, options: Record<string, unknown>): Promise<unknown>;
}

export interface BridgedEndpointInput {
  readonly target: BridgedTarget;
  readonly nodeLabel: string;
  readonly reachable: boolean;
  /** Initial light attributes; `null` for scene endpoints, which are plain triggers. */
  readonly attributes: MatterLightAttributes | null;
}

export interface BridgedDeviceTypes {
  readonly extendedColor: EndpointType;
  readonly colorTemperature: EndpointType;
  readonly dimmable: EndpointType;
  readonly onOff: EndpointType;
}

/**
 * Build the device types once per node.
 *
 * The behaviours close over the router rather than over a single target so that one
 * class serves every endpoint; the endpoint id is the key back to our entity.
 *
 * Each behaviour derives from the *device type's own* requirement alias so the cluster
 * features and attribute constraints the Matter device library mandates stay intact —
 * the only addition is the HueSaturation feature, which matter.js leaves out of the
 * Extended Color Light default but Alexa relies on for "make the lamp blue".
 */
export function createBridgedDeviceTypes(router: MatterCommandRouter): BridgedDeviceTypes {
  class BridgedOnOffServer extends OnOffLightRequirements.OnOffServer {
    override on(): MaybePromise {
      router.setPower(this.endpoint.id, 'on');
      return super.on();
    }

    override off(): MaybePromise {
      router.setPower(this.endpoint.id, 'off');
      return super.off();
    }
  }

  class BridgedLevelControlServer extends DimmableLightRequirements.LevelControlServer {
    /** Covers MoveToLevel and MoveToLevelWithOnOff, the only absolute level commands. */
    override moveToLevelLogic(
      level: number,
      transitionTime: number | null,
      withOnOff: boolean,
      options: TypeFromPartialBitSchema<typeof LevelControl.Options> = {},
    ): MaybePromise {
      router.setLevel(this.endpoint.id, level, transitionTime);
      return super.moveToLevelLogic(level, transitionTime, withOnOff, options);
    }
  }

  /**
   * `moveToHueAndSaturation` delegates to the hue and saturation hooks, so we suppress
   * those while the combined command runs and send a single hub command instead of two.
   */
  class BridgedColorControlServer extends ExtendedColorLightRequirements.ColorControlServer.with(
    'HueSaturation',
    'Xy',
    'ColorTemperature',
  ) {
    #combining = false;

    override moveToHueLogic(
      targetHue: number,
      direction: ColorControl.Direction,
      transitionTime: number,
      isEnhancedHue: boolean,
    ): MaybePromise {
      if (!this.#combining) {
        router.setHueSaturation(
          this.endpoint.id,
          isEnhancedHue ? enhancedHueToMatterHue(targetHue) : targetHue,
          null,
          transitionTime,
        );
      }
      return super.moveToHueLogic(targetHue, direction, transitionTime, isEnhancedHue);
    }

    override moveToSaturationLogic(targetSaturation: number, transitionTime: number): MaybePromise {
      if (!this.#combining) {
        router.setHueSaturation(this.endpoint.id, null, targetSaturation, transitionTime);
      }
      return super.moveToSaturationLogic(targetSaturation, transitionTime);
    }

    override moveToHueAndSaturationLogic(
      targetHue: number,
      targetSaturation: number,
      transitionTime: number,
    ): MaybePromise {
      router.setHueSaturation(this.endpoint.id, targetHue, targetSaturation, transitionTime);
      this.#combining = true;
      const done = (): void => {
        this.#combining = false;
      };
      let result: MaybePromise;
      try {
        result = super.moveToHueAndSaturationLogic(targetHue, targetSaturation, transitionTime);
      } catch (error) {
        done();
        throw error;
      }
      return result instanceof Promise ? result.finally(done) : (done(), result);
    }

    /** Controllers that drive Extended Color Lights in CIE x/y land here instead. */
    override moveToColorLogic(targetX: number, targetY: number, transitionTime: number): MaybePromise {
      const [hue, saturation] = xyToHsv(matterXyToUnit(targetX), matterXyToUnit(targetY));
      router.setHueSaturationDegrees(
        this.endpoint.id,
        Math.round(hue),
        Math.round(saturation * 100),
        transitionTime,
      );
      return super.moveToColorLogic(targetX, targetY, transitionTime);
    }

    override moveToColorTemperatureLogic(targetMireds: number, transitionTime: number): MaybePromise {
      router.setColorTemperature(this.endpoint.id, targetMireds, transitionTime);
      return super.moveToColorTemperatureLogic(targetMireds, transitionTime);
    }
  }

  /** White-only bulbs get the colour-temperature-only variant of the same logic. */
  class BridgedColorTemperatureServer extends ColorTemperatureLightRequirements.ColorControlServer {
    override moveToColorTemperatureLogic(targetMireds: number, transitionTime: number): MaybePromise {
      router.setColorTemperature(this.endpoint.id, targetMireds, transitionTime);
      return super.moveToColorTemperatureLogic(targetMireds, transitionTime);
    }
  }

  return {
    extendedColor: ExtendedColorLightDevice.with(
      BridgedDeviceBasicInformationServer,
      BridgedOnOffServer,
      BridgedLevelControlServer,
      BridgedColorControlServer,
    ),
    colorTemperature: ColorTemperatureLightDevice.with(
      BridgedDeviceBasicInformationServer,
      BridgedOnOffServer,
      BridgedLevelControlServer,
      BridgedColorTemperatureServer,
    ),
    dimmable: DimmableLightDevice.with(
      BridgedDeviceBasicInformationServer,
      BridgedOnOffServer,
      BridgedLevelControlServer,
    ),
    onOff: OnOffLightDevice.with(BridgedDeviceBasicInformationServer, BridgedOnOffServer),
  };
}

const VENDOR_NAME = 'Milight Studio';

/** Build the initial state patch for a bridged endpoint of the given device kind. */
export function bridgedEndpointOptions(input: BridgedEndpointInput): Record<string, unknown> {
  const { target, attributes } = input;
  const options: Record<string, unknown> = {
    id: target.endpointId,
    bridgedDeviceBasicInformation: {
      nodeLabel: input.nodeLabel,
      vendorName: VENDOR_NAME,
      productName: `Milight ${target.kind}`,
      productLabel: input.nodeLabel,
      // Both attributes are capped at 32 characters — a raw uuid (36) does not fit —
      // and Matter requires them to differ, hence the entity-kind prefix.
      serialNumber: `${target.kind.charAt(0)}-${target.uniqueId}`.slice(0, 32),
      uniqueId: target.uniqueId,
      reachable: input.reachable,
    },
  };

  if (attributes === null) {
    options.onOff = { onOff: false };
    return options;
  }

  options.onOff = { onOff: attributes.onOff };

  if (kindHasLevelControl(target.profile.kind)) {
    options.levelControl = { currentLevel: attributes.currentLevel };
  }

  if (kindHasColorControl(target.profile.kind)) {
    const colorControl: Record<string, unknown> = {
      colorTemperatureMireds: attributes.colorTemperatureMireds,
      // Advertise the real MiBoxer white range so Alexa's slider cannot ask for a
      // temperature the bulb has no way of producing. matter.js insists on the couple
      // bounds as soon as the ColorTemperature feature is enabled.
      colorTempPhysicalMinMireds: MIN_MIRED,
      colorTempPhysicalMaxMireds: MAX_MIRED,
      coupleColorTempToLevelMinMireds: MIN_MIRED,
    };
    if (kindHasHueSaturation(target.profile.kind)) {
      colorControl.currentHue = attributes.currentHue;
      colorControl.currentSaturation = attributes.currentSaturation;
      colorControl.colorMode = attributes.colorMode;
      colorControl.enhancedColorMode = attributes.colorMode;
    } else {
      colorControl.colorMode = COLOR_MODE_COLOR_TEMPERATURE;
      colorControl.enhancedColorMode = COLOR_MODE_COLOR_TEMPERATURE;
    }
    options.colorControl = colorControl;
  }

  return options;
}

/** The attribute patch pushed when our shadow state changes. */
export function bridgedStatePatch(
  target: BridgedTarget,
  attributes: MatterLightAttributes,
): { behavior: string; values: Record<string, unknown> }[] {
  const patches: { behavior: string; values: Record<string, unknown> }[] = [
    { behavior: 'onOff', values: { onOff: attributes.onOff } },
  ];

  if (kindHasLevelControl(target.profile.kind)) {
    patches.push({ behavior: 'levelControl', values: { currentLevel: attributes.currentLevel } });
  }

  if (kindHasColorControl(target.profile.kind)) {
    const values: Record<string, unknown> = {
      colorTemperatureMireds: attributes.colorTemperatureMireds,
    };
    if (kindHasHueSaturation(target.profile.kind)) {
      values.currentHue = attributes.currentHue;
      values.currentSaturation = attributes.currentSaturation;
      values.colorMode = attributes.colorMode;
      values.enhancedColorMode = attributes.colorMode;
    } else {
      values.colorMode = COLOR_MODE_COLOR_TEMPERATURE;
    }
    patches.push({ behavior: 'colorControl', values });
  }

  return patches;
}
