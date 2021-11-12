import { Repository } from '@mikro-orm/core';
import { EntityRepository } from '@mikro-orm/postgresql';
import { User } from '../entities/Users';

@Repository(User)
export class UsersRepository extends EntityRepository<User> {
  async makeUser(
    nickname: string,
    sub: string,
    picture: string
  ): Promise<User> {
    const createdUser = this.create({
      username: nickname,
      openIdSub: sub,
      avatarUrl: picture,
    });

    this.persistAndFlush(createdUser);

    return createdUser;
  }
}
