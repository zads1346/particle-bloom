/** Preserve transparency through Three's stock bloom blur.
 * Stock UnrealBloomPass writes alpha=1 in each blur mip, hiding a DOM video
 * backdrop. Carry the same weighted alpha as RGB instead, so empty space stays
 * transparent. This patch is covered against our pinned Three.js version.
 */
export function preserveBloomAlpha(pass) {
  for (const material of pass.separableBlurMaterials) {
    let shader = material.fragmentShader;
    shader = shader.replace(
      "vec3 diffuseSum = texture2D( colorTexture, vUv ).rgb * weightSum;",
      "vec4 diffuseSum = texture2D( colorTexture, vUv ) * weightSum;",
    );
    shader = shader.replace(
      "vec3 sample1 = texture2D( colorTexture, vUv + uvOffset ).rgb;",
      "vec4 sample1 = texture2D( colorTexture, vUv + uvOffset );",
    );
    shader = shader.replace(
      "vec3 sample2 = texture2D( colorTexture, vUv - uvOffset ).rgb;",
      "vec4 sample2 = texture2D( colorTexture, vUv - uvOffset );",
    );
    shader = shader.replace(
      "gl_FragColor = vec4(diffuseSum/weightSum, 1.0);",
      "gl_FragColor = diffuseSum / weightSum;",
    );
    if (
      shader === material.fragmentShader ||
      shader.includes("vec4(diffuseSum/weightSum, 1.0)")
    )
      throw new Error(
        "Pinned bloom shader changed; review alpha preservation.",
      );
    material.fragmentShader = shader;
    material.needsUpdate = true;
  }
  return pass;
}
