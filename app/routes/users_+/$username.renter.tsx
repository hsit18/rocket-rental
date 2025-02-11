import { json, type DataFunctionArgs } from '@remix-run/node'
import { useLoaderData } from '@remix-run/react'
import { V2_MetaFunction } from '@remix-run/server-runtime'
import invariant from 'tiny-invariant'
import { GeneralErrorBoundary } from '~/components/error-boundary'
import { getUserId, requireUserId } from '~/utils/auth.server'
import { prisma } from '~/utils/db.server'
import { useOptionalUser } from '~/utils/misc'
import { createChat, Reviews, UserProfileBasicInfo } from './__shared'

export async function loader({ request, params }: DataFunctionArgs) {
	const loggedInUserId = await getUserId(request)
	invariant(params.username, 'Missing username')
	const user = await prisma.user.findUnique({
		where: { username: params.username },
		select: {
			id: true,
			username: true,
			name: true,
			imageId: true,
			renter: {
				select: {
					userId: true,
					bio: true,
					createdAt: true,
					reviews: {
						select: {
							id: true,
							content: true,
							rating: true,
							reviewer: {
								select: {
									user: {
										select: {
											imageId: true,
											name: true,
											username: true,
										},
									},
								},
							},
							booking: {
								select: {
									ship: {
										select: {
											id: true,
											name: true,
										},
									},
								},
							},
						},
					},
				},
			},
		},
	})
	if (!user?.renter) {
		throw new Response('not found', { status: 404 })
	}

	const totalBookings = await prisma.booking.count({
		where: {
			AND: [{ renterId: user.id }, { endDate: { lte: new Date() } }],
		},
	})
	const averageReviews = await prisma.renterReview.aggregate({
		where: { subjectId: user.id },
		_avg: { rating: true },
	})
	const oneOnOneChat = loggedInUserId
		? await prisma.chat.findFirst({
				where: {
					users: {
						every: {
							id: { in: [user.id, loggedInUserId] },
						},
					},
				},
				select: { id: true },
		  })
		: null

	return json({
		user,
		oneOnOneChat,
		userJoinedDisplay: user.renter.createdAt.toLocaleDateString(),
		totalBookings,
		rating: averageReviews._avg.rating,
	})
}

export async function action({ request, params }: DataFunctionArgs) {
	const formData = await request.formData()
	const loggedInUserId = await requireUserId(request)
	invariant(params.username, 'Missing username')
	const intent = formData.get('intent')
	if (intent === 'create-chat') {
		return createChat({ loggedInUserId, username: params.username })
	}
	throw new Error(`Unknown intent: ${intent}`)
}

export default function RenterUser() {
	const data = useLoaderData<typeof loader>()

	// it's unclear why this is necessary 🤷‍♂️
	invariant(data.user.renter, 'This should not be possible...')

	const loggedInUser = useOptionalUser()
	const isLoggedInUser = loggedInUser?.id === data.user.id

	return (
		<div className="mt-11">
			<UserProfileBasicInfo
				user={data.user}
				rating={data.rating}
				userJoinedDisplay={data.userJoinedDisplay}
				userLoggedIn={Boolean(loggedInUser)}
				isSelf={isLoggedInUser}
				oneOnOneChatId={data.oneOnOneChat?.id}
				stats={[
					{ label: 'trips', num: data.totalBookings },
					{ label: 'reviews', num: data.user.renter.reviews.length },
				]}
				bio={data.user.renter.bio}
			/>

			<Reviews
				title={`${data.user.renter.reviews.length} reviews from hosts`}
				user={data.user}
				rating={data.rating}
				reviews={data.user.renter.reviews}
				reviewerType="host"
			/>
		</div>
	)
}

export function ErrorBoundary() {
	return (
		<GeneralErrorBoundary
			statusHandlers={{
				404: ({ params }) => (
					<p>{params.username} does not have a renter profile</p>
				),
			}}
		/>
	)
}

export const meta: V2_MetaFunction<typeof loader> = ({ data, params }) => {
	const { username } = params
	const displayName = data?.user.name ?? username
	return [
		{ title: `${displayName} | Rocket Rental Renter` },
		{
			name: 'description',
			content: `${displayName} has flown ${
				data?.totalBookings ?? 'some'
			} times in rockets on Rocket Rental.`,
		},
	]
}
