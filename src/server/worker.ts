/*
 * Copyright 2026 Shadrack Omary
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildHttpApp } from './http';

const app = buildHttpApp();

export default {
  fetch: app.fetch,
};
