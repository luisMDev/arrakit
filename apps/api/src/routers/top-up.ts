import { ORPCError } from '@orpc/server'

import { member } from '../orpc/base'
import { requireStripe, requireTrustedOrigin } from '../orpc/context'

export const topUpRouter = {
  topUp: member('admin')
    .use(requireTrustedOrigin('Add credits from the app.'))
    .use(requireStripe)
    .billing.topUp.handler(async ({ context, input }) => {
      const { activeOrganization: organization, user, stripe, deps } = context
      const web = deps.env.webUrl
      try {
        return await stripe.topUpCheckout({
          organizationId: organization.id,
          cents: input.cents,
          customerId: organization.stripeCustomerId,
          email: user.email,
          successUrl: `${web}/app/billing?top_up=paid`,
          cancelUrl: `${web}/app/billing`,
        })
      } catch (error) {
        context.log.error({ err: error, organizationId: organization.id }, 'top-up Checkout failed')
        throw new ORPCError('BAD_GATEWAY', {
          message: "Couldn't load billing from Stripe. Try again in a minute.",
        })
      }
    }),
}
