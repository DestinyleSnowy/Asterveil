import brandIcon from '../../../public/icon/asterveil.svg?raw';
import { mountSubmitter } from '../../submitter/popup';
import '../../submitter/popup.css';

const logo = document.querySelector('.logo');
if (logo) logo.innerHTML = brandIcon;

mountSubmitter();
