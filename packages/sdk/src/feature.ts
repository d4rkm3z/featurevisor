import {
  Allocation,
  Attributes,
  Traffic,
  Feature,
  Variation,
  VariableValue,
  Force,
} from "@featurevisor/types";
import { DatafileReader } from "./datafileReader";
import { allGroupSegmentsAreMatched } from "./segments";
import { allConditionsAreMatched } from "./conditions";
import { VariableSchema } from "@featurevisor/types/src";

export function getMatchedTraffic(
  traffic: Traffic[],
  attributes: Attributes,
  bucketValue: number,
  datafileReader: DatafileReader,
): Traffic | undefined {
  return traffic.find((traffic) => {
    if (bucketValue > traffic.percentage) {
      // out of bucket range
      return false;
    }

    if (
      !allGroupSegmentsAreMatched(
        typeof traffic.segments === "string" && traffic.segments !== "*"
          ? JSON.parse(traffic.segments)
          : traffic.segments,
        attributes,
        datafileReader,
      )
    ) {
      return false;
    }

    return true;
  });
}

// @TODO: make this function better with tests
export function getMatchedAllocation(
  matchedTraffic: Traffic,
  bucketValue: number,
): Allocation | undefined {
  let total = 0;

  for (const allocation of matchedTraffic.allocation) {
    total += allocation.percentage;

    if (bucketValue <= total) {
      return allocation;
    }
  }

  return undefined;
}

function findForceFromFeature(
  feature: Feature,
  attributes: Attributes,
  datafileReader: DatafileReader,
): Force | undefined {
  if (!feature.force) {
    return undefined;
  }

  return feature.force.find((f: Force) => {
    if (f.conditions) {
      return allConditionsAreMatched(f.conditions, attributes);
    }

    if (f.segments) {
      return allGroupSegmentsAreMatched(f.segments, attributes, datafileReader);
    }

    return false;
  });
}

export function getForcedVariation(
  feature: Feature,
  attributes: Attributes,
  datafileReader: DatafileReader,
): Variation | undefined {
  const force = findForceFromFeature(feature, attributes, datafileReader);

  if (!force || !force.variation) {
    return undefined;
  }

  return feature.variations.find((v) => v.value === force.variation);
}

export function getBucketedVariation(
  feature: Feature,
  attributes: Attributes,
  bucketValue: number,
  datafileReader: DatafileReader,
): Variation | undefined {
  const matchedTraffic = getMatchedTraffic(
    feature.traffic,
    attributes,
    bucketValue,
    datafileReader,
  );

  if (!matchedTraffic) {
    return undefined;
  }

  const allocation = getMatchedAllocation(matchedTraffic, bucketValue);

  if (!allocation) {
    return undefined;
  }

  const variationValue = allocation.variation;

  const variation = feature.variations.find((v) => {
    return v.value === variationValue;
  });

  if (!variation) {
    return undefined;
  }

  return variation;
}

export function getForcedVariableValue(
  feature: Feature,
  variableSchema: VariableSchema,
  attributes: Attributes,
  datafileReader: DatafileReader,
): VariableValue | undefined {
  const force = findForceFromFeature(feature, attributes, datafileReader);

  if (!force || !force.variables) {
    return undefined;
  }

  const value = force.variables[variableSchema.key];

  if (typeof value === "string" && variableSchema.type === "json") {
    return JSON.parse(value);
  }

  return value;
}

export function getBucketedVariableValue(
  feature: Feature,
  variableSchema: VariableSchema,
  attributes: Attributes,
  bucketValue: number,
  datafileReader: DatafileReader,
): VariableValue | undefined {
  // get traffic
  const matchedTraffic = getMatchedTraffic(
    feature.traffic,
    attributes,
    bucketValue,
    datafileReader,
  );

  if (!matchedTraffic) {
    return undefined;
  }

  const variableKey = variableSchema.key;

  // see if variable is set at traffic/rule level
  if (matchedTraffic.variables && typeof matchedTraffic.variables[variableKey] !== "undefined") {
    return matchedTraffic.variables[variableKey];
  }

  const allocation = getMatchedAllocation(matchedTraffic, bucketValue);

  if (!allocation) {
    return undefined;
  }

  const variationValue = allocation.variation;

  const variation = feature.variations.find((v) => {
    return v.value === variationValue;
  });

  if (!variation) {
    return undefined;
  }

  const variableFromVariation = variation.variables?.find((v) => {
    return v.key === variableKey;
  });

  if (!variableFromVariation) {
    if (variableSchema.type === "json") {
      return JSON.parse(variableSchema.defaultValue as string);
    }

    return variableSchema.defaultValue;
  }

  if (variableFromVariation.overrides) {
    const override = variableFromVariation.overrides.find((o) => {
      if (o.conditions) {
        return allConditionsAreMatched(
          typeof o.conditions === "string" ? JSON.parse(o.conditions) : o.conditions,
          attributes,
        );
      }

      if (o.segments) {
        return allGroupSegmentsAreMatched(
          typeof o.segments === "string" && o.segments !== "*"
            ? JSON.parse(o.segments)
            : o.segments,
          attributes,
          datafileReader,
        );
      }

      return false;
    });

    if (override) {
      if (variableSchema.type === "json") {
        return JSON.parse(override.value as string);
      }

      return override.value;
    }
  }

  if (variableSchema.type === "json") {
    return JSON.parse(variableFromVariation.value as string);
  }

  return variableFromVariation.value;
}
