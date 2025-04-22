function updateModelPropertiesInPlace(model, callback) {
  for (const [key, prop] of model.properties) {
    const updatedProp = callback(key, prop);
    model.properties.set(key, updatedProp);
  }
}

export function withPartial(_context, target, props) {
  let notFoundProps = new Set(props ?? []);
  updateModelPropertiesInPlace(target, (_key, prop) => {
    if (props == null || props.includes(prop.name)) {
      notFoundProps.delete(prop.name);
      return { ...prop, optional: true };
    }
    return prop;
  });
  if (notFoundProps.size > 0) {
    throw new Error(
      `Partial decorator: properties ${Array.from(notFoundProps).join(', ')} not found`,
    );
  }
}

export const $decorators = { Utils: { withPartial } };
