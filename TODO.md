## Report

**Who's affected:** NanoGPT plugin (`~/.openclaw/extensions/nanogpt/openclaw.plugin.json`)

**What's deprecated:** `providerAuthEnvVars` in the plugin manifest. The warning tells us to mirror the env-var declarations into `setup.providers[].envVars` instead.

**What the current manifest has:**

```json
"providerAuthEnvVars": {
  "nanogpt": ["NANOGPT_API_KEY"]
}
```

**What's missing:** A `setup` block declaring the provider and its env vars. Here's what needs to be added:

```json
"setup": {
  "providers": [
    {
      "id": "nanogpt",
      "envVars": ["NANOGPT_API_KEY"]
    }
  ]
}
```

Note: `providerAuthChoices` is already correctly defined in the manifest, so only `setup.providers` needs adding. `providerAuthEnvVars` can stay temporarily during the deprecation window, but once `setup.providers` is present, the diagnostic warning will stop appearing.

The same pattern applies to any other third-party plugins with the same warning — mirror their `providerAuthEnvVars` entries into `setup.providers[].envVars`.

Want me to make the change for nanogpt?
