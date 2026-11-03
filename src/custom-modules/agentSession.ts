/** Read-only world context shared by the workshop and its capability catalog. */
export interface CustomModuleAgentWorldContext {
  id: string;
  name: string;
  description?: string;
  availability?: { stat: boolean; survival: boolean; business: boolean; currency: boolean };
  survivalResourceIds?: string[];
}
