import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Limpiando datos existentes...');

  // Delete in correct FK order
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.moderationLog.deleteMany(),
    prisma.ban.deleteMany(),
    prisma.mute.deleteMany(),
    prisma.report.deleteMany(),
    prisma.roomParticipant.deleteMany(),
    prisma.room.deleteMany(),
    prisma.circleMember.deleteMany(),
    prisma.circle.deleteMany(),
    prisma.wallLike.deleteMany(),
    prisma.wallEntry.deleteMany(),
    prisma.draft.deleteMany(),
    prisma.profileVisit.deleteMany(),
    prisma.commentReaction.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.reaction.deleteMany(),
    prisma.post.deleteMany(),
    prisma.message.deleteMany(),
    prisma.conversationMember.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.follow.deleteMany(),
    prisma.verificationToken.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  console.log('👤 Creando usuarios...');
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const users = await Promise.all([
    prisma.user.create({
      data: {
        id: 'clx1234567890abcdef',
        email: 'ghost@vhs.net',
        username: 'vhs_ghost',
        displayName: 'VHS_Ghost',
        passwordHash,
        bio: 'Espectro digital atrapado en la señal. Mi existencia es un loop infinito de estática.',
        onboardingCompleted: true,
      },
    }),
    prisma.user.create({
      data: {
        email: 'glitch@vhs.net',
        username: 'glitchwalker',
        displayName: 'GlitchWalker',
        passwordHash,
        bio: 'Caminante entre glitches. Cada error es un portal a otra dimensión.',
        onboardingCompleted: true,
      },
    }),
    prisma.user.create({
      data: {
        email: 'signal@vhs.net',
        username: 'signallost',
        displayName: 'SignalLost',
        passwordHash,
        bio: 'Señal perdida entre el ruido blanco. ¿Me escuchas?',
        onboardingCompleted: true,
      },
    }),
    prisma.user.create({
      data: {
        email: 'analog@vhs.net',
        username: 'analoghorror',
        displayName: 'AnalogHorror',
        passwordHash,
        bio: 'Los archivos de la era analógica guardan verdades que nadie debería conocer.',
        onboardingCompleted: true,
      },
    }),
    prisma.user.create({
      data: {
        email: 'neon@vhs.net',
        username: 'neonphantom',
        displayName: 'NeonPhantom',
        passwordHash,
        bio: 'Fantasma de neón flotando en el vacío digital. La noche es mi lienzo.',
        onboardingCompleted: true,
      },
    }),
  ]);

  const [ghost, glitch, signal, analog, neon] = users;

  console.log('⭕ Creando círculos...');
  const circles = await Promise.all([
    prisma.circle.create({
      data: {
        name: 'Horror Analógico',
        description:
          'Un espacio para explorar el terror de la era VHS. Cintas perdidas, señales interrumpidas y grabaciones que nunca deberían haber existido.',
        creatorId: ghost.id,
        members: {
          create: [
            { userId: ghost.id, role: 'OWNER' },
            { userId: analog.id, role: 'MEMBER' },
            { userId: signal.id, role: 'MEMBER' },
            { userId: neon.id, role: 'MEMBER' },
          ],
        },
      },
    }),
    prisma.circle.create({
      data: {
        name: 'Roleplay en la Sombra',
        description:
          'Historias interactivas de terror y misterio. Crea personajes, explora mundos oscuros y sobrevive la noche.',
        creatorId: ghost.id,
        members: {
          create: [
            { userId: ghost.id, role: 'OWNER' },
            { userId: glitch.id, role: 'MEMBER' },
            { userId: neon.id, role: 'MEMBER' },
          ],
        },
      },
    }),
    prisma.circle.create({
      data: {
        name: 'Devs Oscuros',
        description:
          'Desarrolladores que codifican en la penumbra. Proyectos experimentales, arte generativo y código que cobra vida después de la medianoche.',
        creatorId: ghost.id,
        members: {
          create: [
            { userId: ghost.id, role: 'OWNER' },
            { userId: glitch.id, role: 'MEMBER' },
            { userId: signal.id, role: 'MEMBER' },
            { userId: analog.id, role: 'MEMBER' },
          ],
        },
      },
    }),
  ]);

  const [horrorCircle, roleplayCircle, devsCircle] = circles;

  console.log('📝 Creando posts...');
  const posts = await Promise.all([
    // --- Horror Analógico (4 posts) ---
    prisma.post.create({
      data: {
        content:
          'Encontré una cinta VHS sin etiqueta en una tienda de segunda mano. La reproduje y apareció una habitación vacía... con mi reflejo mirándome desde la pantalla, pero yo estaba parado a tres metros del televisor.',
        authorId: ghost.id,
        circleId: horrorCircle.id,
      },
    }),
    prisma.post.create({
      data: {
        content:
          'Teoría: las cintas de demolición no se destruyen. Absorben lo que grabaron. Alguien encontró una pila de VHS de una casa que fue demolida en los 90 y cada una reproduce la misma noche... la última noche.',
        authorId: analog.id,
        circleId: horrorCircle.id,
      },
    }),
    prisma.post.create({
      data: {
        content:
          'Hay un canal que aparece en la TV a las 3:33 AM solo si la antena está desconectada. No emite nada... solo estática. Pero si grabas la estática y la inviertes, escuchas tu nombre.',
        authorId: signal.id,
        circleId: horrorCircle.id,
      },
    }),
    prisma.post.create({
      data: {
        content:
          'Mi abuela dejó una caja de cintas VHS en el ático. En la última hay 47 minutos de oscuridad total. Pero en el segundo 2847 aparece una figura que se parece mucho a mí, parada en el mismo ático donde estoy ahora.',
        authorId: neon.id,
        circleId: horrorCircle.id,
      },
    }),

    // --- Roleplay en la Sombra (3 posts) ---
    prisma.post.create({
      data: {
        content:
          '[ NUEVA SESIÓN ] La mansión Blackwood abre sus puertas esta noche. 6 jugadores. 1 DM. Nadie sale igual. ¿Quién se apunta? Las reglas: no hay reglas. Solo supervivencia.',
        authorId: ghost.id,
        circleId: roleplayCircle.id,
      },
    }),
    prisma.post.create({
      data: {
        content:
          '[ Character Drop ] Nombre: "Echo". Historia: Un programador que accidentalmente borró su propia existencia de la base de datos del universo. Ahora solo existe cuando alguien lo recuerda. Clase: Fantasmal. Habilidad: "Recall()".',
        authorId: glitch.id,
        circleId: roleplayCircle.id,
      },
    }),
    prisma.post.create({
      data: {
        content:
          'Sesión terminada. Jugador "Phantom" sobrevivió 3 noches. Jugador "Cipher" no durmió ni una. El DM necesita terapia. Próxima sesión: viernes 13. Tema: "Lo que viene después de morir en el juego".',
        authorId: neon.id,
        circleId: roleplayCircle.id,
      },
    }),

    // --- Devs Oscuros (3 posts) ---
    prisma.post.create({
      data: {
        content:
          'Proyecto del día: un generador de arte glitch con WebGL. Toma cualquier imagen y la transforma en algo que parece sacado de una cinta VHS de 1987. Próximamente open source.',
        authorId: glitch.id,
        circleId: devsCircle.id,
      },
    }),
    prisma.post.create({
      data: {
        content:
          '¿Alguien más siente que programar después de medianoche es como entrar en otro plano de existencia? El código fluye diferente. Los bugs tienen más sentido. Y a veces... escribes cosas que no recuerdas haber escrito.',
        authorId: ghost.id,
        circleId: devsCircle.id,
      },
    }),
    prisma.post.create({
      data: {
        content:
          'Acabo de desplegar un microservicio que procesa audio en tiempo real y lo convierte en visualizaciones de ondas de terror. Stack: Rust + WebAudio + Canvas. El demo está en producción. Nadie debería ver esto a las 2 AM.',
        authorId: signal.id,
        circleId: devsCircle.id,
      },
    }),
  ]);

  console.log('❤️ Creando reacciones...');
  await prisma.$transaction([
    // Reactions en posts de Horror Analógico
    prisma.reaction.create({ data: { userId: glitch.id, postId: posts[0].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: signal.id, postId: posts[0].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: neon.id, postId: posts[0].id, type: 'WOW' } }),
    prisma.reaction.create({ data: { userId: analog.id, postId: posts[1].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: ghost.id, postId: posts[1].id, type: 'WOW' } }),
    prisma.reaction.create({ data: { userId: glitch.id, postId: posts[2].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: neon.id, postId: posts[2].id, type: 'WOW' } }),
    prisma.reaction.create({ data: { userId: ghost.id, postId: posts[3].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: signal.id, postId: posts[3].id, type: 'WOW' } }),

    // Reactions en posts de Roleplay
    prisma.reaction.create({ data: { userId: glitch.id, postId: posts[4].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: neon.id, postId: posts[4].id, type: 'LOVE' } }),
    prisma.reaction.create({ data: { userId: analog.id, postId: posts[5].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: ghost.id, postId: posts[5].id, type: 'WOW' } }),
    prisma.reaction.create({ data: { userId: signal.id, postId: posts[6].id, type: 'LIKE' } }),

    // Reactions en posts de Devs Oscuros
    prisma.reaction.create({ data: { userId: ghost.id, postId: posts[7].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: signal.id, postId: posts[7].id, type: 'LOVE' } }),
    prisma.reaction.create({ data: { userId: analog.id, postId: posts[7].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: neon.id, postId: posts[8].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: glitch.id, postId: posts[8].id, type: 'WOW' } }),
    prisma.reaction.create({ data: { userId: analog.id, postId: posts[9].id, type: 'LIKE' } }),
    prisma.reaction.create({ data: { userId: neon.id, postId: posts[9].id, type: 'LOVE' } }),
  ]);

  console.log('💬 Creando comentarios...');
  await prisma.$transaction([
    // Comentarios en posts de Horror Analógico
    prisma.comment.create({
      data: { body: 'He visto esa cinta. No es tu reflejo. Es algo que se hace pasar por ti.', userId: analog.id, postId: posts[0].id },
    }),
    prisma.comment.create({
      data: { body: '¿Alguien más notó que la habitación en la cinta tiene las paredes al revés?', userId: glitch.id, postId: posts[0].id },
    }),
    prisma.comment.create({
      data: { body: 'Esto conecta con la teoría de las "grabaciones fantasma" que documenté el mes pasado.', userId: signal.id, postId: posts[1].id },
    }),
    prisma.comment.create({
      data: { body: 'La teoría de la estática invertida es perturbadoramente consistente con lo que pasó en KDecl.', userId: ghost.id, postId: posts[2].id },
    }),
    prisma.comment.create({
      data: { body: 'Yo también tengo una caja similar. Nunca me atreví a abrirla.', userId: glitch.id, postId: posts[3].id },
    }),

    // Comentarios en posts de Roleplay
    prisma.comment.create({
      data: { body: 'Me uno. ¿Puedo traer mi personaje de la campaña anterior?', userId: glitch.id, postId: posts[4].id },
    }),
    prisma.comment.create({
      data: { body: 'La habilidad "Recall()" está rota. Me encanta.', userId: neon.id, postId: posts[5].id },
    }),

    // Comentarios en posts de Devs Oscuros
    prisma.comment.create({
      data: { body: '¿Open source? Estoy dentro. Necesito eso para un proyecto de arte digital.', userId: ghost.id, postId: posts[7].id },
    }),
    prisma.comment.create({
      data: { body: 'A las 3 AM escribí una función recursiva sin base case y funcionó. No preguntes cómo.', userId: signal.id, postId: posts[8].id },
    }),
    prisma.comment.create({
      data: { body: 'El Rust + WebAudio es una combinación que no sabía que necesitaba.', userId: analog.id, postId: posts[9].id },
    }),
  ]);

  console.log('🔗 Creando relaciones de seguimiento...');
  await prisma.$transaction([
    // VHS_Ghost sigue a todos
    prisma.follow.create({ data: { followerId: ghost.id, followingId: glitch.id } }),
    prisma.follow.create({ data: { followerId: ghost.id, followingId: signal.id } }),
    prisma.follow.create({ data: { followerId: ghost.id, followingId: analog.id } }),
    prisma.follow.create({ data: { followerId: ghost.id, followingId: neon.id } }),

    // Otros siguen a VHS_Ghost
    prisma.follow.create({ data: { followerId: glitch.id, followingId: ghost.id } }),
    prisma.follow.create({ data: { followerId: analog.id, followingId: ghost.id } }),
    prisma.follow.create({ data: { followerId: neon.id, followingId: ghost.id } }),

    // Relaciones entre otros usuarios
    prisma.follow.create({ data: { followerId: glitch.id, followingId: signal.id } }),
    prisma.follow.create({ data: { followerId: signal.id, followingId: glitch.id } }),
    prisma.follow.create({ data: { followerId: analog.id, followingId: neon.id } }),
    prisma.follow.create({ data: { followerId: neon.id, followingId: analog.id } }),
    prisma.follow.create({ data: { followerId: signal.id, followingId: neon.id } }),
  ]);

  console.log('✅ Seed completado exitosamente.');
  console.log(`   👤 ${users.length} usuarios creados (password: Password123!)`);
  console.log(`   ⭕ ${circles.length} círculos creados`);
  console.log(`   📝 ${posts.length} posts creados`);
  console.log(`   🔗 12 relaciones de seguimiento creadas`);
}

main()
  .catch((e) => {
    console.error('❌ Error durante el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
